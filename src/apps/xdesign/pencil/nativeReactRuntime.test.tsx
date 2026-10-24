import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NativeDesignView, type NativeReactAssets } from './nativeReactRuntime';
import type { NativeReactInput, NativeReactModel, NativeReactMotionInfo, NativeReactOutput } from './nativeReactProtocol';
import type { DesignControlSnapshot, DesignInteraction, DesignNode, DesignProps } from './reactExportRuntime';
import type { PrototypeSession } from './prototypeValues';

it('publishes the newest mounted render, retains successful pixels on failure and releases the worker on unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  class BrowserWorker {
    onmessage: ((event: MessageEvent<NativeReactOutput>) => void) | null = null;
    onerror = null; onmessageerror = null;
    messages: NativeReactInput[] = [];
    postMessage(message: NativeReactInput) { this.messages.push(message); }
    terminate = vi.fn();
    constructor() { workers.push(this); }
    send(message: NativeReactOutput) { this.onmessage?.({ data: message } as MessageEvent<NativeReactOutput>); }
  }
  const workers: BrowserWorker[] = [], createURL = vi.fn(() => 'blob:native-worker'), revoke = vi.fn(), onError = vi.fn();
  vi.stubGlobal('Worker', BrowserWorker); vi.stubGlobal('URL', { createObjectURL: createURL, revokeObjectURL: revoke });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const assets: NativeReactAssets = { worker: '', wasm: btoa('12345678'), graph: '{}', ids: ['root'], fonts: { registrations: [] } };
  const model = (width: number): NativeReactModel => ({ width, height: 80, nodes: [{ id: 'root', name: 'Painted native root', visible: true, children: [], style: { width, height: 80 }, image: `data:image/png;base64,${btoa(String(width))}` }] });
  const width = () => host.querySelector<HTMLDivElement>('[data-xdesign-view]')?.style.width;
  const current = () => workers[0]!.messages.filter(message => message.type === 'render').at(-1)!;
  try {
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={model(100)} width={120} onPrototypeError={onError}/>));
    const worker = workers[0]!;
    await act(async () => worker.send({ type: 'ready' }));
    const first = current(); if (first.type !== 'render') throw new Error('Missing render request.');
    await act(async () => worker.send({ type: 'model', id: first.id, model: model(120) }));
    expect(width()).toBe('120px');
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={model(100)} width={300} onPrototypeError={onError}/>));
    const old = current(); if (old.type !== 'render') throw new Error('Missing resize request.');
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={model(100)} width={500} onPrototypeError={onError}/>));
    await act(async () => worker.send({ type: 'model', id: old.id, model: model(300) }));
    expect(width()).toBe('120px');
    const latest = current(); if (latest.type !== 'render') throw new Error('Missing latest request.');
    await act(async () => worker.send({ type: 'model', id: latest.id, model: model(500) }));
    expect(width()).toBe('500px');
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={model(100)} width={600} onPrototypeError={onError}/>));
    const failed = current(); if (failed.type !== 'render') throw new Error('Missing failing request.');
    await act(async () => worker.send({ type: 'error', id: failed.id, message: 'Missing glyph' }));
    expect(width()).toBe('500px'); expect(host.querySelector('[role="alert"]')!.textContent).toContain('Missing glyph');
    expect(onError).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

type NativeTestWorker = {
  onmessage: ((event: MessageEvent<NativeReactOutput>) => void) | null; onerror: null; onmessageerror: null;
  messages: NativeReactInput[]; postMessage: (message: NativeReactInput) => void; send: (message: NativeReactOutput) => void; terminate: ReturnType<typeof vi.fn>;
};
function nativeAssets(rootId = 'home'): NativeReactAssets {
  return { worker: '', wasm: btoa('12345678'), graph: '{}', ids: ['home', 'modal', 'details'], rootId, fonts: { registrations: [] } };
}
const prototypeVariables = {
  variables: [{ id: 'flag', name: 'Flag', type: 'BOOLEAN' as const, collectionId: 'collection', valuesByMode: { mode: false } }],
  collections: [{ id: 'collection', name: 'Collection', defaultModeId: 'mode', modes: [{ modeId: 'mode', name: 'Default' }] }], modes: {},
};
function textLayer(id: string, name: string, interaction?: DesignInteraction, sourceId = id): DesignNode {
  return { id, sourceId, name, text: name, visible: true, style: { position: 'absolute', left: 8, top: 8, width: 120, height: 28 }, children: [], ...(interaction ? { interactions: [interaction] } : {}) };
}
function nativeScreen(request: Extract<NativeReactInput, { type: 'render' }>['request']): NativeReactModel {
  const id = request.rootId ?? 'home', renderRoot = request.controlScope ? JSON.stringify(['overlay', request.controlScope, id]) : id, children: DesignNode[] = [];
  if (id === 'home') {
    children.push(textLayer(`${renderRoot}/hold`, 'Hold overlay', { id: 'hold', trigger: { type: 'press' }, navigation: { action: 'overlay', target: 'modal', transition: 'instant', duration: 0 } }, `${id}/hold`));
    children.push(textLayer(`${renderRoot}/open`, 'Open overlay', { id: 'open', trigger: { type: 'click' }, navigation: { action: 'overlay', target: 'modal', transition: 'instant', duration: 0 } }, `${id}/open`));
    children.push(textLayer(`${renderRoot}/details`, 'Go details', { id: 'details', trigger: { type: 'click' }, navigation: { action: 'navigate', target: 'details', transition: 'instant', duration: 0 } }, `${id}/details`));
    children.push(textLayer(`${renderRoot}/smart`, 'Smart details', { id: 'smart', trigger: { type: 'click' }, navigation: { action: 'navigate', target: 'details', transition: 'smart', duration: 100 } }, `${id}/smart`));
    children.push(textLayer(`${renderRoot}/smart-sequence`, 'Sequence smart details', { id: 'smart-sequence', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [
      { action: 'set-variable', variable: 'flag', value: { type: 'literal', value: true }, transition: 'instant', duration: 0 },
      { action: 'navigate', target: 'details', transition: 'smart', duration: 100 },
    ] } }, `${id}/smart-sequence`));
    children.push(textLayer(`${renderRoot}/drag`, 'Drag details', { id: 'drag', trigger: { type: 'drag' }, navigation: { action: 'navigate', target: 'details', transition: 'smart', duration: 100 } }, `${id}/drag`));
    children.push(textLayer(`${renderRoot}/drag-variable`, 'Drag flag', { id: 'drag-variable', trigger: { type: 'drag' }, navigation: { action: 'set-variable', variable: 'flag', value: { type: 'literal', value: true }, transition: 'smart', duration: 100 } }, `${id}/drag-variable`));
  }
  if (id === 'details') children.push(textLayer(`${renderRoot}/back-smart`, 'Back smart', { id: 'back-smart', trigger: { type: 'click' }, navigation: { action: 'back', transition: 'smart', duration: 100 } }, `${id}/back-smart`));
  if (id === 'modal') {
    children.push(textLayer(`${renderRoot}/open`, 'Open again', { id: 'open-again', trigger: { type: 'click' }, navigation: { action: 'overlay', target: 'modal', transition: 'instant', duration: 0 } }, `${id}/open`));
    children.push(textLayer(`${renderRoot}/close`, 'Close overlay', { id: 'close', trigger: { type: 'click' }, navigation: { action: 'close', transition: 'instant', duration: 0 } }, `${id}/close`));
    children.push(textLayer(`${renderRoot}/automatic`, 'Automatic details', { id: 'automatic', trigger: { type: 'delay', delay: 40 }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [
      { action: 'set-variable', variable: 'flag', value: { type: 'literal', value: true }, transition: 'instant', duration: 0 },
      { action: 'navigate', target: 'details', transition: 'instant', duration: 0 },
    ] } }, `${id}/automatic`));
    children.push({ id: `${renderRoot}/scroll`, sourceId: `${id}/scroll`, name: 'Independent scroll', visible: true, style: { position: 'absolute', left: 8, top: 80, width: 120, height: 32 }, scroll: { axis: 'vertical' }, children: [textLayer(`${renderRoot}/scroll/content`, 'Scroll content', undefined, `${id}/scroll/content`)] });
    const controlKey = JSON.stringify([renderRoot, 'check']), snapshot = request.controls?.[controlKey];
    children.push({ id: `${renderRoot}/check`, sourceId: `${id}/check`, name: 'Modal check', visible: true, style: { position: 'absolute', left: 8, top: 48, width: 80, height: 30 }, children: [], control: { native: { key: controlKey, values: {}, selected: [], ratio: 0 }, playback: snapshot ?? { value: false, state: 'rest' }, kind: 'checkbox', defaults: { value: false }, booleans: {}, numbers: {}, variants: [{ properties: {}, tree: { id: `${renderRoot}/check-art`, sourceId: `${id}/check-art`, name: 'Mark', text: 'Mark', visible: true, style: { width: 80, height: 30 }, children: [] } }], properties: {} } });
  }
  const rootWidth = request.rootSizes?.[id]?.width ?? (id === 'modal' ? 160 : 320), rootHeight = request.rootSizes?.[id]?.height ?? (id === 'modal' ? 120 : 240);
  const root: DesignNode = { id: renderRoot, sourceId: id, name: id === 'home' ? 'Home' : id === 'modal' ? 'Modal' : 'Details', visible: true, style: { position: 'absolute', left: 0, top: 0, width: rootWidth, height: rootHeight }, children,
    ...(id === 'modal' ? { overlay: { position: 'bottom-right', closeOutside: true, background: { r: 0, g: 0, b: 0, a: .4 } } } : {}) };
  return { nodes: [root], width: rootWidth, height: rootHeight, byteLength: 256, prototypeVariables };
}
async function mountNativeHost(onControlState?: (key: string, snapshot: DesignControlSnapshot) => void, onPrototypeSessionChange?: (session: PrototypeSession) => void, onNavigate?: DesignProps['onNavigate'], onScrollPositionChange?: DesignProps['onScrollPositionChange'], makeModel:typeof nativeScreen=nativeScreen, onOpenUrl?: DesignProps['onOpenUrl']) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const workers: NativeTestWorker[] = [], createURL = vi.fn(() => 'blob:native-worker'), revoke = vi.fn();
  class BrowserWorker {
    onmessage: NativeTestWorker['onmessage'] = null; onerror = null; onmessageerror = null; messages: NativeReactInput[] = []; terminate = vi.fn();
    constructor() { workers.push(this as NativeTestWorker); }
    postMessage(message: NativeReactInput) { this.messages.push(message); }
    send(message: NativeReactOutput) { this.onmessage?.({ data: message } as MessageEvent<NativeReactOutput>); }
  }
  vi.stubGlobal('Worker', BrowserWorker); vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: createURL, revokeObjectURL: revoke }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), assets = nativeAssets();
  const pending = new Set<number>();
  const currentWorker = () => workers[0]!;
  const nextRequest = async () => {
    for (let retry = 0; retry < 30; retry++) {
      const message = currentWorker().messages.find(item => item.type === 'render' && !pending.has(item.id));
      if (message?.type === 'render') { pending.add(message.id); return message; }
      await act(async () => { await Promise.resolve(); });
    }
    throw new Error('Native screen render was not requested.');
  };
  const nextMotion = async (type: 'motion-prepare' | 'motion-frame') => {
    for (let retry = 0; retry < 30; retry++) {
      const message = currentWorker().messages.find(item => item.type === type && !pending.has(item.id));
      if (message && (message.type === 'motion-prepare' || message.type === 'motion-frame')) { pending.add(message.id); return message; }
      await act(async () => { await Promise.resolve(); });
    }
    throw new Error(`Native ${type} request was not sent.`);
  };
  const answerNext = async (failure?: string) => {
    const request = await nextRequest();
    await act(async () => { currentWorker().send(failure ? { type: 'error', id: request.id, message: failure } : { type: 'model', id: request.id, model: makeModel(request.request) }); await Promise.resolve(); await Promise.resolve(); });
    return request;
  };
  const answerRoute = async (count: number) => { const requests = []; for (let index = 0; index < count; index++) requests.push(await answerNext()); return requests; };
  await act(async () => root.render(<NativeDesignView assets={assets} initialModel={makeModel({ rootId: 'home' })} width={300} onControlState={onControlState} onPrototypeSessionChange={onPrototypeSessionChange} onNavigate={onNavigate} onScrollPositionChange={onScrollPositionChange} onOpenUrl={onOpenUrl} />));
  await act(async () => currentWorker().send({ type: 'ready' }));
  await answerNext();
  const answerMotionPrepare = async (makeMotion: (sessionId: number) => NativeReactMotionInfo) => { const request = await nextMotion('motion-prepare'); if (request.type !== 'motion-prepare') throw new Error('Expected a motion preparation request.'); const motion = makeMotion(request.motion.sessionId); await act(async () => { currentWorker().send({ type: 'motion-ready', id: request.id, motion }); await Promise.resolve(); await Promise.resolve(); }); return request; };
  const failMotionPrepare = async (message: string) => { const request = await nextMotion('motion-prepare'); await act(async () => { currentWorker().send({ type: 'error', id: request.id, message }); await Promise.resolve(); await Promise.resolve(); }); return request; };
  const answerMotionFrame = async (progress: number, model = motionStage(progress)) => { const request = await nextMotion('motion-frame'); expect(request.type).toBe('motion-frame'); if (request.type !== 'motion-frame') throw new Error('Expected a motion frame request.'); expect(request.progress).toBeCloseTo(progress); await act(async () => { currentWorker().send({ type: 'model', id: request.id, model }); await Promise.resolve(); await Promise.resolve(); }); return request; };
  const answerCurrentMotionFrame = async () => { const request = await nextMotion('motion-frame'); if (request.type !== 'motion-frame') throw new Error('Expected a motion frame request.'); await act(async () => { currentWorker().send({ type: 'model', id: request.id, model: motionStage(request.progress) }); await Promise.resolve(); await Promise.resolve(); }); return request.progress; };
  return { assets, host, root, workers, currentWorker, answerNext, answerRoute, answerMotionPrepare, failMotionPrepare, answerMotionFrame, answerCurrentMotionFrame, createURL, revoke };
}

it.each([undefined,false,true])('native host Open link newTab=%s preserves the active overlay, base, media, control and scroll without a render request',async flag=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  const address='https://example.com/native-review?mode=canvas#comments',open=vi.fn(),navigate=vi.fn(),control=vi.fn(),session=vi.fn();
  const makeModel=(request:Extract<NativeReactInput,{type:'render'}>['request'])=>{const model=nativeScreen(request),owner=model.nodes[0]!;owner.children.push(textLayer(`${owner.id}/url`,'Native external review',{id:'native-url',trigger:{type:'click'},navigation:{action:'open-url',url:address,...(flag===undefined?{}:{newTab:flag}),transition:'instant',duration:0}}));if((request.rootId??'home')==='home')owner.children.push({id:'home/video',name:'Native URL video',visible:true,style:{width:80,height:45},children:[],video:{src:'data:video/webm;base64,AQID',poster:'data:image/png;base64,iVBORw0KGgo=',autoplay:false,loop:false,muted:true,controls:true,style:{}}});return model;};
  const mounted=await mountNativeHost(control,session,navigate,undefined,makeModel,open);
  try{
    const base=mounted.host.querySelector<HTMLElement>('[data-native-screen="home"]')!,video=mounted.host.querySelector<HTMLVideoElement>('video')!;Object.defineProperties(video,{currentTime:{configurable:true,value:1.5},paused:{configurable:true,value:false}});const videoIdentity=[video.getAttribute('src'),video.getAttribute('poster')];
    await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Open overlay"]')!.click());await mounted.answerRoute(2);
    const overlay=mounted.host.querySelector<HTMLElement>('[data-native-overlay]')!,scroll=overlay.querySelector<HTMLElement>('[data-xdesign-scroll]')!,check=overlay.querySelector<HTMLElement>('[role="checkbox"]')!;
    await act(async()=>check.click());await mounted.answerRoute(2);const currentOverlay=mounted.host.querySelector<HTMLElement>('[data-native-overlay]')!,currentScroll=currentOverlay.querySelector<HTMLElement>('[data-xdesign-scroll]')!,currentCheck=currentOverlay.querySelector<HTMLElement>('[role="checkbox"]')!;currentScroll.scrollLeft=17;currentScroll.scrollTop=83;
    const requests=mounted.currentWorker().messages.length,controls=control.mock.calls.length,sessions=session.mock.calls.length,navigations=navigate.mock.calls.length;
    const button=currentOverlay.querySelector<HTMLElement>('[aria-label="Native external review"]')!;await act(async()=>button.click());await act(async()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(open.mock.calls).toEqual([[address,flag??true],[address,flag??true]]);expect(mounted.currentWorker().messages).toHaveLength(requests);expect(control).toHaveBeenCalledTimes(controls);expect(session).toHaveBeenCalledTimes(sessions);expect(navigate).toHaveBeenCalledTimes(navigations);
    expect(mounted.host.querySelector('[data-native-screen="home"]')).toBe(base);expect(mounted.host.querySelector('[data-native-overlay]')).toBe(currentOverlay);expect(currentOverlay.querySelector('[role="checkbox"]')).toBe(currentCheck);expect(currentCheck.getAttribute('aria-checked')).toBe('true');expect(currentOverlay.querySelector('[data-xdesign-scroll]')).toBe(currentScroll);expect([currentScroll.scrollLeft,currentScroll.scrollTop]).toEqual([17,83]);expect(mounted.host.querySelector('video')).toBe(video);expect([video.currentTime,video.paused]).toEqual([1.5,false]);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(videoIdentity);expect(scroll).toBe(currentScroll);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it.each(['false','reject'] as const)('native host refuses URL callback %s without preparing a route or running the next action',async failure=>{
  const open=vi.fn(()=>failure==='false'?false:Promise.reject(new Error('Native URL refusal'))),navigate=vi.fn();
  const makeModel=(request:Extract<NativeReactInput,{type:'render'}>['request'])=>{const model=nativeScreen(request);model.nodes[0]!.children.push(textLayer('url-sequence','Native URL refusal',{id:'url-sequence',trigger:{type:'click'},navigation:{action:'sequence',transition:'instant',duration:0,actions:[{action:'open-url',url:'https://example.com/refused',transition:'instant',duration:0},{action:'navigate',target:'details',transition:'instant',duration:0}]}}));return model;};
  const mounted=await mountNativeHost(undefined,undefined,navigate,undefined,makeModel,open);
  try{const before=mounted.host.querySelector('[data-native-screen="home"]'),requests=mounted.currentWorker().messages.length;await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native URL refusal"]')!.click());expect(open.mock.calls).toEqual([['https://example.com/refused',true]]);expect(navigate).not.toHaveBeenCalled();expect(mounted.currentWorker().messages).toHaveLength(requests);expect(mounted.host.querySelector('[data-native-screen="home"]')).toBe(before);expect(mounted.host.querySelectorAll('[data-native-overlay]')).toHaveLength(0);expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBeTruthy();}
  finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

function nativeVideoScreen(request:Extract<NativeReactInput,{type:'render'}>['request'],resetVideoPosition?:boolean):NativeReactModel {
  const id=request.rootId??'home',renderRoot=request.controlScope?JSON.stringify(['overlay',request.controlScope,id]):id;
  const route=(name:string,action:'navigate'|'overlay'|'swap',target:string,reset?:boolean)=>textLayer(`${renderRoot}/${name}`,name,{id:name,trigger:{type:'click'},navigation:{action,target,transition:'instant',duration:0,...(reset===undefined?{}:{resetVideoPosition:reset})}},`${id}/${name}`);
  const video:DesignNode={id:`${renderRoot}/video`,sourceId:`${id}/video`,name:'Native retained clip',visible:true,style:{width:80,height:45},children:[],video:{src:'data:video/webm;base64,AQID',poster:'data:image/png;base64,iVBORw0KGgo=',autoplay:false,loop:false,muted:true,controls:true,style:{}}};
  const children=[video,route('Reset video self','navigate',id,resetVideoPosition),route('Open video overlay','overlay','modal'),route('Reset video overlay','swap','modal',true)];
  return{width:320,height:240,byteLength:256,nodes:[{id:renderRoot,sourceId:id,name:id,visible:true,style:{width:320,height:240},children}],prototypeVariables};
}
function nativeVideoClock(video:HTMLVideoElement,time=1.5,ready=true){
  let position=time,metadata=ready;const seeks:number[]=[];Object.defineProperties(video,{currentTime:{configurable:true,get:()=>position,set:(value:number)=>{if(!metadata)throw new DOMException('No metadata','InvalidStateError');position=value;seeks.push(value);}},readyState:{configurable:true,get:()=>metadata?1:0},duration:{configurable:true,get:()=>3},paused:{configurable:true,value:true}});
  return{seeks,get time(){return position;},metadata:()=>act(async()=>{metadata=true;video.dispatchEvent(new Event('loadedmetadata'));})};
}

function nativeTransportClock(video:HTMLVideoElement,time=1.5,initialPaused=true){
  let position=time,paused=initialPaused;const seeks:number[]=[];Object.defineProperties(video,{currentTime:{configurable:true,get:()=>position,set:(value:number)=>{position=value;seeks.push(value);}},readyState:{configurable:true,value:1},duration:{configurable:true,value:3},paused:{configurable:true,get:()=>paused}});
  const play=vi.fn(async()=>{paused=false;}),pause=vi.fn(()=>{paused=true;});Object.defineProperties(video,{play:{configurable:true,writable:true,value:play},pause:{configurable:true,writable:true,value:pause}});return{play,pause,seeks,get time(){return position;},get paused(){return paused;}};
}
function nativeTransportScreen(request:Extract<NativeReactInput,{type:'render'}>['request']):NativeReactModel{
  const model=nativeVideoScreen(request),owner=model.nodes[0]!,id=request.rootId??'home';
  for(const operation of ['play','pause','toggle'] as const)owner.children.push(textLayer(`${owner.id}/transport-${operation}`,`Native transport ${operation}`,{id:`transport-${operation}`,trigger:{type:'click'},navigation:{action:'media',mediaAction:operation,target:`${id}/video`,transition:'instant',duration:0}}));
  owner.children.push(textLayer(`${owner.id}/transport-sequence`,'Native transport sequence',{id:'transport-sequence',trigger:{type:'click'},navigation:{action:'sequence',transition:'instant',duration:0,actions:[{action:'media',mediaAction:'play',target:`${id}/video`,transition:'instant',duration:0},{action:'navigate',target:'details',transition:'instant',duration:0}]}}));
  owner.children.push(textLayer(`${owner.id}/arriving-media`,'Native arriving media',{id:'arriving-media',trigger:{type:'click'},navigation:{action:'sequence',transition:'instant',duration:0,actions:[{action:'navigate',target:'details',transition:'instant',duration:0},{action:'media',mediaAction:'play',target:'details/video',transition:'instant',duration:0}]}}));
  return model;
}
it('native host targeted media keeps video/source/poster and host state without worker or navigation callbacks',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const navigate=vi.fn(),controls=vi.fn(),session=vi.fn(),mounted=await mountNativeHost(controls,session,navigate,undefined,nativeTransportScreen);
  try{const video=mounted.host.querySelector('video')!,clock=nativeTransportClock(video),identity=[video.getAttribute('src'),video.getAttribute('poster')],view=mounted.host.querySelector('[data-xdesign-view]'),requests=mounted.currentWorker().messages.length;
    await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native transport play"]')!.click());expect(clock.paused).toBe(false);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native transport pause"]')!.click());expect(clock.paused).toBe(true);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native transport toggle"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(clock.paused).toBe(false);
    expect(clock.play).toHaveBeenCalledTimes(2);expect(clock.pause).toHaveBeenCalledOnce();expect([clock.time,clock.seeks]).toEqual([1.5,[]]);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);expect(mounted.host.querySelector('video')).toBe(video);expect(mounted.host.querySelector('[data-xdesign-view]')).toBe(view);expect(mounted.currentWorker().messages).toHaveLength(requests);expect(navigate).not.toHaveBeenCalled();expect(controls).not.toHaveBeenCalled();expect(session).not.toHaveBeenCalled();
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host awaits targeted Play and reports refusal before any following route preparation',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const navigate=vi.fn(),mounted=await mountNativeHost(undefined,undefined,navigate,undefined,nativeTransportScreen);
  try{const video=mounted.host.querySelector('video')!,clock=nativeTransportClock(video),requests=mounted.currentWorker().messages.length,view=mounted.host.querySelector('[data-xdesign-view]');let reject!:(error:Error)=>void;clock.play.mockImplementation(()=>new Promise<void>((_,no)=>{reject=no;}));await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native transport sequence"]')!.click());expect(clock.play).toHaveBeenCalledOnce();expect(mounted.currentWorker().messages).toHaveLength(requests);await act(async()=>reject(new Error('Native playback refused')));expect(mounted.host.querySelector('[role=alert]')?.textContent).toContain('Native playback refused');expect(mounted.currentWorker().messages).toHaveLength(requests);expect(navigate).not.toHaveBeenCalled();expect(mounted.host.querySelector('[data-xdesign-view]')).toBe(view);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,true,[]]);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host resolves repeated overlay media inside the top occurrence without affecting lower/base or requesting renders',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const mounted=await mountNativeHost(undefined,undefined,undefined,undefined,nativeTransportScreen);
  try{const base=mounted.host.querySelector('video')!,baseClock=nativeTransportClock(base);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Open video overlay"]')!.click());await mounted.answerRoute(2);const lower=mounted.host.querySelector<HTMLVideoElement>('[data-native-overlay] video')!,lowerClock=nativeTransportClock(lower,2);const openers=mounted.host.querySelectorAll<HTMLElement>('[aria-label="Open video overlay"]');await act(async()=>openers[openers.length-1]!.click());await mounted.answerRoute(3);const overlays=mounted.host.querySelectorAll<HTMLElement>('[data-native-overlay]'),top=overlays[1]!.querySelector<HTMLVideoElement>('video')!,topClock=nativeTransportClock(top,2.5),requests=mounted.currentWorker().messages.length;
    await act(async()=>overlays[1]!.querySelector<HTMLElement>('[aria-label="Native transport play"]')!.click());expect([topClock.time,topClock.paused,topClock.seeks]).toEqual([2.5,false,[]]);expect([lowerClock.time,lowerClock.paused,lowerClock.seeks]).toEqual([2,true,[]]);expect([baseClock.time,baseClock.paused,baseClock.seeks]).toEqual([1.5,true,[]]);expect(mounted.currentWorker().messages).toHaveLength(requests);expect(mounted.host.querySelectorAll('[data-native-overlay]')).toHaveLength(2);expect(overlays[0]!.querySelector('video')).toBe(lower);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host sequences target media on the successfully published arriving screen',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined),mounted=await mountNativeHost(undefined,undefined,undefined,undefined,nativeTransportScreen);
  try{const outgoing=mounted.host.querySelector('video')!;await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Native arriving media"]')!.click());expect(play).not.toHaveBeenCalled();await mounted.answerNext();const video=mounted.host.querySelector('video')!;expect(video).not.toBe(outgoing);expect(play).toHaveBeenCalledOnce();expect(play.mock.instances[0]).toBe(video);expect(mounted.host.querySelector('[data-native-screen="details"]')).toBeTruthy();expect(mounted.host.querySelector('[role=alert]')).toBeNull();const requests=mounted.currentWorker().messages.length;await act(async()=>{await Promise.resolve();});expect(mounted.currentWorker().messages).toHaveLength(requests);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it.each([undefined,false,true])('native host same-screen resetVideoPosition=%s keeps video identity and commits reset only when requested',async flag=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const mounted=await mountNativeHost(undefined,undefined,undefined,undefined,request=>nativeVideoScreen(request,flag));
  try{const video=mounted.host.querySelector('video')!,clock=nativeVideoClock(video),identity=[video.getAttribute('src'),video.getAttribute('poster')];await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Reset video self"]')!.click());if(flag)await mounted.answerNext();
    expect(clock.time).toBe(flag?0:1.5);expect(mounted.host.querySelector('video')).toBe(video);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);expect(video.paused).toBe(true);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host defers a committed video reset until metadata and keeps failed preparation playback unchanged',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const mounted=await mountNativeHost(undefined,undefined,undefined,undefined,request=>nativeVideoScreen(request,true));
  try{const video=mounted.host.querySelector('video')!,clock=nativeVideoClock(video,1.5,false);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Reset video self"]')!.click());await mounted.answerNext('Video preparation failed');expect(clock.seeks).toEqual([]);expect(clock.time).toBe(1.5);expect(mounted.host.querySelector('video')).toBe(video);
    await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Reset video self"]')!.click());await mounted.answerNext();expect(clock.time).toBe(1.5);expect(clock.seeks).toEqual([]);await clock.metadata();expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(mounted.host.querySelector('video')).toBe(video);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host canceled preparation never seeks its detached media after a late worker reply',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const mounted=await mountNativeHost(undefined,undefined,undefined,undefined,request=>nativeVideoScreen(request,true));
  try{const video=mounted.host.querySelector('video')!,clock=nativeVideoClock(video);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Reset video self"]')!.click());const pending=mounted.currentWorker().messages.filter(item=>item.type==='render').at(-1)!;expect(pending.type).toBe('render');await act(async()=>mounted.root.unmount());
    if(pending.type!=='render')throw new Error('Missing video reset render');await act(async()=>mounted.currentWorker().send({type:'model',id:pending.id,model:nativeVideoScreen(pending.request,true)}));expect(clock.time).toBe(1.5);expect(clock.seeks).toEqual([]);expect(mounted.host.childElementCount).toBe(0);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('native host resets only an arriving repeated overlay and keeps base and lower media occurrences untouched',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const mounted=await mountNativeHost(undefined,undefined,undefined,undefined,request=>nativeVideoScreen(request,true));
  try{const base=mounted.host.querySelector('video')!,baseClock=nativeVideoClock(base,1.5);await act(async()=>mounted.host.querySelector<HTMLElement>('[aria-label="Open video overlay"]')!.click());await mounted.answerRoute(2);
    const lower=mounted.host.querySelector<HTMLVideoElement>('[data-native-overlay] video')!,lowerClock=nativeVideoClock(lower,2);const openers=mounted.host.querySelectorAll<HTMLElement>('[aria-label="Open video overlay"]');await act(async()=>openers[openers.length-1]!.click());await mounted.answerRoute(3);
    const beforeTop=mounted.host.querySelectorAll<HTMLVideoElement>('[data-native-overlay] video')[1]!,topClock=nativeVideoClock(beforeTop,2.5);const resets=mounted.host.querySelectorAll<HTMLElement>('[aria-label="Reset video overlay"]');await act(async()=>resets[resets.length-1]!.click());await mounted.answerRoute(3);
    const overlays=mounted.host.querySelectorAll<HTMLVideoElement>('[data-native-overlay] video');expect(overlays).toHaveLength(2);expect(baseClock.time).toBe(1.5);expect(lowerClock.time).toBe(2);expect(overlays[0]).toBe(lower);expect(overlays[1]!.currentTime).toBe(0);expect(topClock.time).toBe(2.5);expect(mounted.host.querySelector('video')).toBe(base);
  }finally{await act(async()=>mounted.root.unmount());mounted.host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

function motionStage(progress: number): NativeReactModel {
  const width = 280 + progress;
  return { width, height: 220, nodes: [{ id: 'motion-stage', sourceId: 'motion-stage', name: `Native frame ${progress.toFixed(2)}`, visible: true, style: { position: 'absolute', left: 0, top: 0, width, height: 220 }, children: [] }], byteLength: 128 };
}
function nativePointer(type: string, x: number, y: number, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ clientX: x, clientY: y, timeStamp: time, pointerId: 1, button: 0 })) Object.defineProperty(event, key, { value });
  return event;
}

it('prepares base and repeated overlay occurrences in order, isolates their local control state and restores focus', async () => {
  const mounted = await mountNativeHost();
  try {
    const { host, currentWorker, answerNext, answerRoute } = mounted;
    const opener = host.querySelector<HTMLElement>('[aria-label="Open overlay"]')!; opener.focus(); await act(async () => opener.click());
    const baseRequest = await answerNext(); const firstRequest = await answerNext();
    expect(baseRequest.request.rootId).toBe('home'); expect(baseRequest.request.rootSizes?.home?.width).toBe(300);
    expect(firstRequest.request.rootId).toBe('modal'); expect(firstRequest.request.controlScope).toBeTruthy();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    const checkboxes = () => host.querySelectorAll<HTMLElement>('[role="checkbox"]');
    const firstCheckbox = checkboxes()[0]!; expect(firstCheckbox.getAttribute('aria-checked')).toBe('false');
    act(() => firstCheckbox.click()); await answerRoute(2); expect(checkboxes()[0]!.getAttribute('aria-checked')).toBe('true');
    const sameOpener = host.querySelector<HTMLElement>('[aria-label="Open again"]')!; sameOpener.focus(); await act(async () => sameOpener.click());
    const repeatedBase = await answerNext(), firstCopy = await answerNext(), secondCopy = await answerNext();
    expect(repeatedBase.request.rootId).toBe('home'); expect(firstCopy.request.controlScope).not.toBe(secondCopy.request.controlScope);
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(2); expect(checkboxes()[0]!.getAttribute('aria-checked')).toBe('true'); expect(checkboxes()[1]!.getAttribute('aria-checked')).toBe('false');
    const scrolls = host.querySelectorAll<HTMLElement>('[data-xdesign-scroll]'); expect(scrolls).toHaveLength(2); expect(scrolls[0]!.dataset.xdesignScroll).not.toBe(scrolls[1]!.dataset.xdesignScroll); scrolls[0]!.scrollTop = 24; scrolls[0]!.dispatchEvent(new Event('scroll')); expect(scrolls[1]!.scrollTop).toBe(0);
    act(() => checkboxes()[1]!.click()); const changed = await answerRoute(3);
    const changedControls = changed.at(-1)!.request.controls ?? {}, scopedValue = (scope: string) => Object.entries(changedControls).find(([key]) => key.includes(scope))?.[1]?.value;
    expect(scopedValue(firstCopy.request.controlScope!)).toBe(true); expect(scopedValue(secondCopy.request.controlScope!)).toBe(true);
    expect(checkboxes()[0]!.getAttribute('aria-checked')).toBe('true'); expect(checkboxes()[1]!.getAttribute('aria-checked')).toBe('true');
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await answerNext(); await answerNext();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(document.activeElement?.getAttribute('data-xdesign-source')).toBe('modal/open'); expect(checkboxes()[0]!.getAttribute('aria-checked')).toBe('true');
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Close overlay"]')!.click()); await answerNext();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(0); expect(document.activeElement?.getAttribute('data-xdesign-source')).toBe('home/open');
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Open overlay"]')!.click()); await answerNext(); await answerNext();
    expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector<HTMLElement>('[data-xdesign-scroll]')?.scrollTop).toBe(24);
    expect(currentWorker().terminate).not.toHaveBeenCalled();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('retains the active native screen on destination preparation failure and sizes each new base root', async () => {
  const mounted = await mountNativeHost();
  try {
    const { host, answerNext } = mounted;
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Go details"]')!.click());
    const request = await answerNext('Details renderer failed');
    expect(request.request.rootId).toBe('details'); expect(request.request.rootSizes?.details?.width).toBe(300);
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull(); expect(host.querySelector('[data-native-screen="details"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Details renderer failed');
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Go details"]')!.click()); await answerNext();
    expect(host.querySelector('[data-native-screen="details"]')).not.toBeNull(); expect(host.querySelector<HTMLElement>('[data-xdesign-view]')?.style.width).toBe('300px');
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('keeps the old route until native frame zero is ready and commits after native frame one applies', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0, now = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockImplementation(() => now);
  const onScroll = vi.fn(); const mounted = await mountNativeHost(undefined, undefined, undefined, onScroll);
  try {
    const { host, answerNext, answerMotionPrepare, answerMotionFrame, currentWorker } = mounted;
    const opener = host.querySelector<HTMLElement>('[aria-label="Smart details"]')!; opener.focus(); await act(async () => opener.click());
    const destination = await answerNext(); expect(destination.request.rootId).toBe('details');
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    const sampledScroll = { 'sampler/scroll': { x: 7, y: 41 } };
    await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: {}, movement: { x: -300, y: 0 }, initialModel: { ...motionStage(0), scrollPositions: sampledScroll } }));
    expect(host.querySelector('[data-native-motion-frame]')).not.toBeNull();
    expect(host.querySelector('[data-native-motion-frame] [data-xdesign-view]')?.getAttribute('style')).toContain('width: 280px');
    await answerMotionFrame(0, { ...motionStage(0), scrollPositions: sampledScroll });
    expect(onScroll).not.toHaveBeenCalled(); expect(document.activeElement).toBe(host.querySelector('[data-native-react-host]'));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(tab)); expect(tab.defaultPrevented).toBe(true);
    await act(async () => { now = 100; const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(callback => callback(now)); await Promise.resolve(); });
    await answerMotionFrame(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="details"]')).not.toBeNull();
    expect(onScroll).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Back smart"]')!.click()); await answerNext();
    const returnMotion = currentWorker().messages.filter(message => message.type === 'motion-prepare').at(-1);
    expect(returnMotion?.type).toBe('motion-prepare'); if (returnMotion?.type === 'motion-prepare') expect(returnMotion.motion.from.scrollPositions).toEqual({});
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('honors an owner veto before publishing or preparing a native motion', async () => {
  const veto = vi.fn(async () => false), mounted = await mountNativeHost(undefined, undefined, veto);
  try {
    await act(async () => mounted.host.querySelector<HTMLElement>('[aria-label="Smart details"]')!.click());
    expect(veto).toHaveBeenCalledOnce();
    expect(mounted.host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(mounted.host.querySelector('[data-native-screen="details"]')).toBeNull();
    expect(mounted.currentWorker().messages.some(message => message.type === 'motion-prepare')).toBe(false);
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('retains the source route when native motion preparation fails', async () => {
  const mounted = await mountNativeHost();
  try {
    await act(async () => mounted.host.querySelector<HTMLElement>('[aria-label="Smart details"]')!.click());
    await mounted.answerNext(); await mounted.failMotionPrepare('Motion graph could not be prepared');
    expect(mounted.host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(mounted.host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(mounted.host.querySelector('[data-native-screen="details"]')).toBeNull();
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain('Motion graph could not be prepared');
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('accepts a prepared variable step before navigation and retains its source after motion preparation fails', async () => {
  const accept = vi.fn(async (_session: PrototypeSession) => true), mounted = await mountNativeHost(undefined, accept);
  try {
    await act(async () => mounted.host.querySelector<HTMLElement>('[aria-label="Sequence smart details"]')!.click());
    const variableStep = await mounted.answerNext(); expect(variableStep.request.rootId).toBe('home');
    expect(accept).toHaveBeenCalledOnce(); expect(accept.mock.calls[0]?.[0].values.flag).toBe(true);
    const destination = await mounted.answerNext(); expect(destination.request.rootId).toBe('details');
    await mounted.failMotionPrepare('Motion graph could not be prepared');
    expect(accept).toHaveBeenCalledOnce();
    expect(mounted.host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(mounted.host.querySelector('[data-native-screen="details"]')).toBeNull();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('discards a stale native motion plan after a host-size generation change', async () => {
  const mounted = await mountNativeHost();
  try {
    const { host, root, assets, currentWorker, answerNext } = mounted;
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Smart details"]')!.click());
    await answerNext();
    const motionRequest = currentWorker().messages.find(message => message.type === 'motion-prepare');
    expect(motionRequest?.type).toBe('motion-prepare'); if (!motionRequest || motionRequest.type !== 'motion-prepare') throw new Error('Missing native motion request.');
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={nativeScreen({ rootId: 'home' })} width={400} />));
    await act(async () => currentWorker().send({ type: 'motion-ready', id: motionRequest.id, motion: { sessionId: motionRequest.motion.sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: {}, initialModel: motionStage(0) } }));
    const resize = await answerNext(); expect(resize.request.rootSizes?.home?.width).toBe(400);
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(host.querySelector('[data-native-screen="details"]')).toBeNull();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('restores the saved source before resize re-render and ignores a late sampled motion frame', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0, now = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockImplementation(() => now);
  const mounted = await mountNativeHost();
  try {
    const { host, root, assets, currentWorker, answerNext, answerMotionPrepare } = mounted;
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Smart details"]')!.click()); await answerNext();
    await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: {}, initialModel: motionStage(0) }));
    expect(host.querySelector('[data-native-motion-frame]')).not.toBeNull();
    await act(async () => { now = 16; const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(callback => callback(now)); await Promise.resolve(); });
    const staleFrame = currentWorker().messages.filter(message => message.type === 'motion-frame').at(-1);
    expect(staleFrame?.type).toBe('motion-frame');
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={nativeScreen({ rootId: 'home' })} width={400} />));
    if (staleFrame?.type === 'motion-frame') await act(async () => currentWorker().send({ type: 'model', id: staleFrame.id, model: motionStage(.4) }));
    const rerender = await answerNext();
    expect(rerender.request.rootId).toBe('home'); expect(rerender.request.rootSizes?.home?.width).toBe(400);
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(host.querySelector<HTMLElement>('[data-xdesign-view]')?.style.width).toBe('400px');
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('buffers a release before native drag preparation and restores the exact source route at endpoint zero', async () => {
  const mounted = await mountNativeHost();
  try {
    const { host, answerNext, answerMotionPrepare, answerCurrentMotionFrame } = mounted;
    const source = host.querySelector<HTMLElement>('[data-xdesign-source="home/drag"]')!;
    act(() => source.dispatchEvent(nativePointer('pointerdown', 0, 20, 0)));
    act(() => document.dispatchEvent(nativePointer('pointermove', 60, 20, 80)));
    act(() => document.dispatchEvent(nativePointer('pointerup', 0, 20, 180)));
    expect(await answerNext().then(request => request.request.rootId)).toBe('details');
    await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: { 'home/drag': { x: -300, y: 0 } }, initialModel: motionStage(0) }));
    for (let index = 0; index < 3 && host.querySelector('[data-native-motion-frame]'); index++) await answerCurrentMotionFrame();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(host.querySelector('[data-native-screen="details"]')).toBeNull();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('restores the source on external controlled updates without echoing old state to its owner', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const owner = vi.fn(), mounted = await mountNativeHost(undefined, owner);
  try {
    const { host, root, assets, currentWorker, answerNext, answerMotionPrepare } = mounted;
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Smart details"]')!.click()); await answerNext();
    await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: {}, initialModel: motionStage(0) }));
    const stale = currentWorker().messages.filter(message => message.type === 'motion-frame').at(-1)!;
    if (stale.type !== 'motion-frame') throw new Error('Missing pending frame.');
    const incoming = { values: { flag: true }, modes: {} }, controls = { external: { value: true, state: 'rest' as const } };
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={nativeScreen({ rootId: 'home' })} width={300} prototypeSession={incoming} controlSession={controls} onPrototypeSessionChange={owner} />));
    await act(async () => currentWorker().send({ type: 'model', id: stale.id, model: motionStage(.7) }));
    const request = await answerNext();
    expect(request.request.rootId).toBe('home'); expect(request.request.session).toEqual(incoming); expect(request.request.controls).toEqual(controls);
    expect(owner).not.toHaveBeenCalled(); expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull(); expect(host.querySelector('[data-native-screen="details"]')).toBeNull();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('retains a drag through an accepted owner echo and restores controlled variables on rollback', async () => {
  let mounted: Awaited<ReturnType<typeof mountNativeHost>>;
  let accept: (() => void) | undefined;
  const sessions: PrototypeSession[] = [], errors = vi.fn();
  const owner: NonNullable<DesignProps['onPrototypeSessionChange']> = next => {
    sessions.push(structuredClone(next));
    mounted.root.render(<NativeDesignView assets={mounted.assets} initialModel={nativeScreen({ rootId: 'home' })} width={300} prototypeSession={structuredClone(next)} onPrototypeSessionChange={owner} onPrototypeError={errors} />);
    if (next.values.flag === true) return new Promise<boolean>(resolve => { accept = () => resolve(true); });
  };
  mounted = await mountNativeHost(undefined, owner);
  try {
    const { host, root, assets, currentWorker, answerNext, answerMotionPrepare, answerCurrentMotionFrame } = mounted;
    const initial = { values: { flag: false }, modes: {} };
    await act(async () => root.render(<NativeDesignView assets={assets} initialModel={nativeScreen({ rootId: 'home' })} width={300} prototypeSession={initial} onPrototypeSessionChange={owner} onPrototypeError={errors} />));
    await answerNext();
    const source = host.querySelector<HTMLElement>('[data-xdesign-source="home/drag-variable"]')!;
    act(() => source.dispatchEvent(nativePointer('pointerdown', 0, 20, 0)));
    act(() => document.dispatchEvent(nativePointer('pointermove', 60, 20, 80)));
    const destination = await answerNext();
    expect(destination.request.session?.values.flag).toBe(true);
    const motion = await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 300, height: 240 }, movements: { 'home/drag-variable': { x: -300, y: 0 } }, initialModel: motionStage(0) }));
    expect(accept).toBeTypeOf('function');
    await act(async () => { accept!(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[data-native-motion-frame]')).not.toBeNull();
    expect(currentWorker().messages.some(message => message.type === 'motion-cancel' && message.sessionId === motion.motion.sessionId)).toBe(false);
    act(() => document.dispatchEvent(nativePointer('pointerup', 0, 20, 180)));
    for (let index = 0; index < 4 && host.querySelector('[data-native-motion-frame]'); index++) await answerCurrentMotionFrame();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(sessions.map(session => session.values.flag)).toEqual([true, false]);
    expect(errors).not.toHaveBeenCalled();
    expect(currentWorker().messages.filter(message => message.type === 'motion-prepare')).toHaveLength(1);
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it.each(['reject', 'throw', 'external'] as const)('keeps ownership when a deferred echoed drag is superseded by %s', async outcome => {
  let mounted: Awaited<ReturnType<typeof mountNativeHost>>;
  let settle: (() => void) | undefined;
  const errors = vi.fn(), sessions: PrototypeSession[] = [], initial = { values: { flag: false }, modes: {} };
  const renderOwner = (session: PrototypeSession) => mounted.root.render(<NativeDesignView assets={mounted.assets} initialModel={nativeScreen({ rootId: 'home' })} width={300} prototypeSession={session} onPrototypeSessionChange={owner} onPrototypeError={errors} />);
  const owner: NonNullable<DesignProps['onPrototypeSessionChange']> = next => {
    sessions.push(structuredClone(next)); renderOwner(structuredClone(next));
    return new Promise<boolean>((resolve, reject) => { settle = () => outcome === 'throw' ? reject(new Error('Owner declined this change.')) : resolve(outcome === 'external'); });
  };
  mounted = await mountNativeHost(undefined, owner);
  try {
    const { host, currentWorker, answerNext, answerMotionPrepare } = mounted;
    await act(async () => renderOwner(initial)); await answerNext();
    act(() => host.querySelector<HTMLElement>('[data-xdesign-source="home/drag-variable"]')!.dispatchEvent(nativePointer('pointerdown', 0, 20, 0)));
    act(() => document.dispatchEvent(nativePointer('pointermove', 60, 20, 80)));
    await answerNext();
    const motion = await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 300, height: 240 }, movements: {}, initialModel: motionStage(0) }));
    expect(settle).toBeTypeOf('function');
    if (outcome === 'external') await act(async () => renderOwner(structuredClone(initial)));
    await act(async () => { settle!(); await Promise.resolve(); await Promise.resolve(); });
    const reconciliation = await answerNext();
    expect(reconciliation.request.rootId).toBe('home');
    expect(reconciliation.request.session?.values.flag).toBe(outcome !== 'external');
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(currentWorker().messages.some(message => message.type === 'motion-cancel' && message.sessionId === motion.motion.sessionId)).toBe(true);
    expect(sessions.map(session => session.values.flag)).toEqual([true]);
    if (outcome === 'throw') expect(errors).toHaveBeenCalledWith(expect.stringContaining('Owner declined this change.'));
    else expect(errors).not.toHaveBeenCalled();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('commits a native drag only after its endpoint-one model is applied', async () => {
  const mounted = await mountNativeHost();
  try {
    const { host, answerNext, answerMotionPrepare, answerCurrentMotionFrame } = mounted;
    const source = host.querySelector<HTMLElement>('[data-xdesign-source="home/drag"]')!;
    act(() => source.dispatchEvent(nativePointer('pointerdown', 0, 20, 0)));
    act(() => document.dispatchEvent(nativePointer('pointermove', -300, 20, 80)));
    act(() => document.dispatchEvent(nativePointer('pointerup', -300, 20, 180)));
    expect(await answerNext().then(request => request.request.rootId)).toBe('details');
    await answerMotionPrepare(sessionId => ({ sessionId, matched: 1, from: { width: 300, height: 240 }, to: { width: 320, height: 240 }, movements: { 'home/drag': { x: -300, y: 0 } }, initialModel: motionStage(0) }));
    for (let index = 0; index < 4 && host.querySelector('[data-native-motion-frame]'); index++) await answerCurrentMotionFrame();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[data-native-motion-frame]')).toBeNull();
    expect(host.querySelector('[data-native-screen="details"]')).not.toBeNull();
    expect(host.querySelector('[data-native-screen="home"]')).toBeNull();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.unstubAllGlobals(); }
});

it('restores a held native checkpoint after destination control edits and automatic navigation', async () => {
  vi.useFakeTimers();
  const controlStates: Array<{ key: string; snapshot: DesignControlSnapshot }> = [];
  const sessions: PrototypeSession[] = [];
  const mounted = await mountNativeHost((key, snapshot) => controlStates.push({ key, snapshot }), session => sessions.push(session));
  try {
    const { host, answerRoute } = mounted;
    const source = host.querySelector<HTMLElement>('[data-xdesign-source="home/hold"]')!;
    const down = new Event('pointerdown', { bubbles: true }) as PointerEvent; Object.defineProperty(down, 'button', { value: 0 }); act(() => source.dispatchEvent(down));
    await answerRoute(2);
    const check = host.querySelector<HTMLElement>('[role="checkbox"]')!;
    act(() => check.click()); await answerRoute(2);
    expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(controlStates.at(-1)?.snapshot.value).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    await answerRoute(2);
    expect(sessions.at(-1)?.values.flag).toBe(true);
    await answerRoute(1);
    expect(host.querySelector('[data-native-screen="details"]')).not.toBeNull();
    act(() => document.dispatchEvent(new Event('pointerup')));
    expect(host.querySelector('[data-native-screen="home"]')).not.toBeNull();
    expect(host.querySelector('[data-native-screen="details"]')).toBeNull();
    expect(controlStates.at(-1)?.snapshot.value).toBe(false);
    expect(sessions.at(-1)?.values.flag).toBeUndefined();
  } finally { await act(async () => mounted.root.unmount()); mounted.host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
