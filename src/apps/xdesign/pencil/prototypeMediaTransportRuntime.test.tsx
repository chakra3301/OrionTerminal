import * as React from 'react';
import { act } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { transform } from 'sucrase';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { serializeGraph } from './document';
import { setNavigation, setPrototypeInteractions } from './prototype';
import { placePreparedVideo } from './videoPaints';
import type { DesignMediaAction, DesignMediaState, DesignNavigation, DesignNode, DesignProps, DesignTrigger } from './reactExportRuntime';

let host: HTMLDivElement, root: Root;
const media = (target: string, mediaAction: DesignMediaAction): DesignNavigation => ({ action:'media', target, mediaAction, transition:'instant', duration:0 });
const sequence = (...actions: DesignNavigation[]): DesignNavigation => ({ action:'sequence', actions, transition:'instant', duration:0 });
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.stubGlobal('matchMedia',(query: string) => ({ matches:query.includes('(hover: hover)') })); vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(() => {});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function generated(action: (first: string,second: string) => DesignNavigation = first => media(first,'play'), trigger?: DesignTrigger) {
  const editor=createEditor(),graph=editor.graph,page=editor.state.currentPageId;
  const screen=graph.createNode('FRAME',page,{ name:'Media transport',width:320,height:240,fills:[] });
  const button=graph.createNode('TEXT',screen.id,{ name:'Playback action',text:'Playback action',width:140,height:24 });
  const video=(name: string,bytes: number[],x: number) => { const id=placePreparedVideo(editor,{ bytes:new Uint8Array(bytes),poster:new Uint8Array([137,80,78,71,...bytes]),mime:'video/webm',name,width:80,height:45,duration:3 },x,50); graph.reparentNode(id,screen.id); return id; };
  const first=video('First clip',[1,2,3],0),second=video('Second clip',[4,5,6],100);
  const navigation=action(first,second); if (trigger) setPrototypeInteractions(editor,button,[{ id:'transport',trigger,navigation }]); else setNavigation(editor,button,navigation);
  const other=graph.createNode('TEXT',screen.id,{ name:'Pause newer action',text:'Pause',y:120,width:80,height:24 }); setNavigation(editor,other,media(first,'pause'));
  const before=serializeGraph(graph),undo=editor.undo.canUndo,redo=editor.undo.canRedo;
  const model=selectionToDesignModel(graph,[screen.id]),delivered: { default?:React.ComponentType<DesignProps>; DesignView?:typeof import('./reactExportRuntime').DesignView; createDesignMediaState?:() => DesignMediaState } = {};
  const code=transform(selectionToReact(graph,[screen.id]).code,{ transforms:['typescript','jsx','imports'],jsxRuntime:'automatic',production:true }).code;
  new Function('require','exports',code)((id: string) => { if (id==='react') return React; if (id==='react/jsx-runtime') return jsxRuntime; throw new Error(`Unexpected media transport import ${id}`); },delivered);
  expect(delivered.default).toBeTypeOf('function');
  const state=delivered.createDesignMediaState!();
  const mount=(props: DesignProps = {},strict=false) => act(() => { const view=React.createElement(delivered.default!,{ mediaState:state,...props }); root.render(strict?<React.StrictMode>{view}</React.StrictMode>:view); });
  const mountNodes=(nodes: DesignNode[],props: DesignProps = {},strict=false) => act(() => { const view=React.createElement(delivered.DesignView!,{ nodes,width:320,height:240,mediaState:state,...props }); root.render(strict?<React.StrictMode>{view}</React.StrictMode>:view); });
  const unchanged=() => { expect(serializeGraph(graph)).toBe(before); expect(editor.undo.canUndo).toBe(undo); expect(editor.undo.canRedo).toBe(redo); };
  const buttonElement=() => host.querySelector<HTMLElement>('[data-name="Playback action"]')!;
  return { editor,model,mount,mountNodes,state,delivered,button:buttonElement,unchanged,first,second };
}
function clock(element: HTMLVideoElement,start=1.5,initialPaused=true) {
  let time=start,paused=initialPaused; const seeks:number[]=[];
  Object.defineProperties(element,{ currentTime:{ configurable:true,get:()=>time,set:(next:number)=>{ time=next; seeks.push(next); } },paused:{ configurable:true,get:()=>paused },readyState:{ configurable:true,get:()=>1 },duration:{ configurable:true,get:()=>3 } });
  const pause=vi.fn(()=>{ paused=true; }),play=vi.fn(async()=>{ paused=false; });Object.defineProperties(element,{pause:{configurable:true,writable:true,value:pause},play:{configurable:true,writable:true,value:play}});
  return { seeks,pause,play,get time(){return time;},get paused(){return paused;},sample(value: number,end=false){ time=value; return act(async()=>element.dispatchEvent(new Event(end?'ended':'timeupdate'))); } };
}
const videos=() => [...host.querySelectorAll<HTMLVideoElement>('video')];
const tick=() => act(async()=>{ await vi.advanceTimersByTimeAsync(64); });
function pointer(target: EventTarget,type: string,x=0,time=0) { const event=new Event(type,{ bubbles:true,cancelable:true }); Object.assign(event,{ pointerId:9,pointerType:'mouse',button:0,clientX:x,clientY:0 }); Object.defineProperty(event,'timeStamp',{value:time}); target.dispatchEvent(event); }
function cloneNodes(nodes: DesignNode[],change:(node:DesignNode)=>void): DesignNode[] { return nodes.map(node => { const copy={ ...node,style:{ ...node.style },children:cloneNodes(node.children,change) }; change(copy); return copy; }); }

it.each(['play','pause','toggle'] as const)('actual generated %s acts once on the exact video for click and Enter without seeking or routing',async operation => {
  const f=generated(first=>media(first,operation)),errors=vi.fn(); try {
    f.mount({ mediaState:undefined,onPrototypeError:errors }); const [first,second]=videos(),a=clock(first!,1.5,operation!=='pause'),b=clock(second!,2,false),identity=[first!.getAttribute('src'),first!.getAttribute('poster')],view=host.querySelector('[data-xdesign-view]');
    await act(async()=>f.button().click()); expect(a.paused).toBe(operation==='pause'); expect(operation==='pause'?a.pause:a.play).toHaveBeenCalledOnce(); expect([a.time,b.time,b.paused]).toEqual([1.5,2,false]); expect(a.seeks).toEqual([]); expect(b.seeks).toEqual([]);
    f.button().focus(); await act(async()=>f.button().dispatchEvent(new KeyboardEvent('keydown',{ key:'Enter',bubbles:true }))); expect(a.paused).toBe(operation==='play'?false:true); expect(host.querySelector('[data-xdesign-view]')).toBe(view); expect(videos()[0]).toBe(first); expect([first!.getAttribute('src'),first!.getAttribute('poster')]).toEqual(identity); expect(errors).not.toHaveBeenCalled(); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('calls play synchronously, awaits it before the next target and executes only the selected conditional branch',async()=>{
  const f=generated((first,second)=>sequence(media(first,'play'),{ action:'conditional',transition:'instant',duration:0,branches:[{ condition:{type:'literal',value:false},actions:[media(first,'pause')] },{ actions:[media(second,'pause')] }] })),pending=deferred(); try {
    f.mount(); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false); a.play.mockImplementation(()=>pending.promise);
    act(()=>f.button().click()); expect(a.play).toHaveBeenCalledOnce(); expect(b.pause).not.toHaveBeenCalled(); await act(async()=>pending.resolve()); expect(b.pause).toHaveBeenCalledOnce(); expect(a.pause).not.toHaveBeenCalled(); expect(a.seeks).toEqual([]); expect(b.seeks).toEqual([]); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('reports actual play rejection and stops later media and route actions without preparing or seeking',async()=>{
  const f=generated((first,second)=>sequence(media(first,'play'),media(second,'pause'),{action:'back',transition:'instant',duration:0})),navigate=vi.fn(),errors=vi.fn(); try {
    f.mount({ onNavigate:navigate,onPrototypeError:errors }); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false); a.play.mockRejectedValue(new Error('Playback policy refused'));
    await act(async()=>f.button().click()); expect(errors).toHaveBeenCalledWith('Error: Playback policy refused'); expect(b.pause).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(a.seeks).toEqual([]); expect(b.seeks).toEqual([]); expect(videos()[0]).toBe(first); f.unchanged();
  } finally { f.editor.dispose(); }
});

it.each(['resolve','reject'] as const)('a newer action invalidates pending playback before obsolete continuation or stale %s feedback',async settle=>{
  const f=generated((first,second)=>sequence(media(first,'play'),media(second,'pause'))),pending=deferred(),errors=vi.fn(); try {
    f.mount({ onPrototypeError:errors }); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false); a.play.mockReturnValue(pending.promise); await act(async()=>f.button().click()); await act(async()=>host.querySelector<HTMLElement>('[data-name="Pause newer action"]')!.click()); expect(a.pause).toHaveBeenCalledOnce(); await act(async()=>settle==='resolve'?pending.resolve():pending.reject(new Error('Obsolete playback failure'))); expect(b.pause).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled(); expect(a.seeks).toEqual([]); f.unchanged();
  } finally { f.editor.dispose(); }
});

it.each(['hidden','inert','disabled','ambiguous','missing'] as const)('refuses %s targets without queuing transport for a later mount',async refusal=>{
  const f=generated(),errors=vi.fn(); try {
    const target=f.model.nodes[0]!.children.find(node=>node.name==='First clip')!;
    const nodes=cloneNodes(f.model.nodes,node=>{ if(node.id===target.id){ if(refusal==='hidden')node.style.display='none'; if(refusal==='inert')node.hitHidden=true; if(refusal==='missing')node.visible=false; } });
    if(refusal==='ambiguous'){const View=f.delivered.DesignView!;act(()=>root.render(<><View nodes={nodes} width={320} height={240} mediaState={f.state} onPrototypeError={errors}/><View nodes={nodes} width={320} height={240} mediaState={f.state} onPrototypeError={errors}/></>));}else f.mountNodes(nodes,{ onPrototypeError:errors,disabled:refusal==='disabled' }); const clocks=videos().map(element=>clock(element));
    if(refusal==='disabled') await expect(f.state.transport(target.id,'play')).rejects.toThrow(); else await act(async()=>f.button().click()); expect(clocks.every(item=>item.play.mock.calls.length===0)).toBe(true); if(refusal!=='disabled')expect(errors).toHaveBeenCalled();
    f.mountNodes(f.model.nodes); await tick(); expect(clocks.every(item=>item.play.mock.calls.length===0)).toBe(true); f.unchanged();
  } finally { f.editor.dispose(); }
});

it.each(['source','unmount'] as const)('retires pending target generation on %s and never delivers obsolete continuation/errors',async change=>{
  const f=generated((first,second)=>sequence(media(first,'play'),media(second,'pause'))),pending=deferred(),errors=vi.fn(); try {
    f.mountNodes(f.model.nodes,{onPrototypeError:errors},true); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false); a.play.mockReturnValue(pending.promise); await act(async()=>f.button().click());
    if(change==='unmount')act(()=>root.render(null)); else f.mountNodes(cloneNodes(f.model.nodes,node=>{ if(node.name==='First clip')node.video={...node.video!,src:'data:video/webm;base64,NEW'}; }),{onPrototypeError:errors},true);
    const cleanupPauses=b.pause.mock.calls.length; await act(async()=>pending.reject(new Error('Old source rejected'))); expect(errors).not.toHaveBeenCalled(); expect(b.pause).toHaveBeenCalledTimes(cleanupPauses); expect(a.seeks).toEqual([]); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('keeps separate media owners isolated, supports a unique source alias and rejects ambiguous aliases',async()=>{
  const f=generated(); try {
    const target=f.model.nodes[0]!.children.find(node=>node.name==='First clip')!,source='authored-video'; const nodes=cloneNodes(f.model.nodes,node=>{if(node.id===target.id)node.sourceId=source;}); const left=f.delivered.createDesignMediaState!(),right=f.delivered.createDesignMediaState!();
    const View=f.delivered.DesignView!; act(()=>root.render(<><View nodes={nodes} width={320} height={240} mediaState={left}/><View nodes={nodes} width={320} height={240} mediaState={right}/></>));
    const all=videos(),a=clock(all[0]!),b=clock(all[2]!); await act(async()=>left.transport(source,'play')); expect(a.play).toHaveBeenCalledOnce(); expect(b.play).not.toHaveBeenCalled(); expect(a.seeks).toEqual([]); expect(b.seeks).toEqual([]);
    const ambiguous=cloneNodes(nodes,node=>{if(node.name==='Second clip')node.sourceId=source;}); f.mountNodes(ambiguous); await expect(f.state.transport(source,'pause')).rejects.toThrow('ambiguous'); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('pause/play/toggle leave spent timestamp and end reactions armed exactly once without seeking',async()=>{
  const f=generated(),navigate=vi.fn(); try {
    const nodes=cloneNodes(f.model.nodes,node=>{if(node.name==='First clip')node.interactions=[{id:'hit',trigger:{type:'media-hit',time:1},navigation:{action:'back',transition:'instant',duration:0}},{id:'end',trigger:{type:'media-end'},navigation:{action:'back',transition:'instant',duration:0}}];});
    f.mountNodes(nodes,{onNavigate:navigate}); const first=videos()[0]!,a=clock(first!),target=nodes[0]!.children.find(node=>node.name==='First clip')!.id;
    await a.sample(1.5); await tick(); expect(navigate).toHaveBeenCalledOnce(); for(const operation of ['pause','play','toggle'] as const)await act(async()=>f.state.transport(target,operation)); await a.sample(1.5); await tick(); expect(navigate).toHaveBeenCalledOnce(); await a.sample(3,true); await tick(); expect(navigate).toHaveBeenCalledTimes(2); await act(async()=>f.state.transport(target,'pause')); await a.sample(3,true); await tick(); expect(navigate).toHaveBeenCalledTimes(2); expect(a.seeks).toEqual([]); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('a generated held Play restores only touched video time/playback on release and never prepares a route',async()=>{
  const f=generated(first=>media(first,'play'),{type:'press'}),navigate=vi.fn(); try {
    f.mount({onNavigate:navigate}); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false);
    await act(async()=>pointer(f.button(),'pointerdown')); expect(a.paused).toBe(false); await a.sample(1.8); await b.sample(2.3); await act(async()=>pointer(document,'pointerup')); await tick(); expect([a.time,a.paused]).toEqual([1.5,true]); expect(a.seeks).toEqual([1.5]); expect([b.time,b.paused,b.seeks]).toEqual([2.3,false,[]]); expect(navigate).not.toHaveBeenCalled(); expect(videos()[0]).toBe(first); f.unchanged();
    a.play.mockRejectedValue(new Error('Held playback refused')); await act(async()=>pointer(f.button(),'pointerdown')); await act(async()=>pointer(document,'pointerup')); await tick(); expect([a.time,a.paused,a.seeks]).toEqual([1.5,true,[1.5]]); expect(host.querySelector('[role=alert]')?.textContent).toContain('Held playback refused'); expect(b.seeks).toEqual([]);
  } finally { f.editor.dispose(); }
});

it.each(['cancel','restore','commit'] as const)('generated media drag %s uses playback checkpoints without navigation or scroll changes',async ending=>{
  const f=generated(first=>media(first,'play'),{type:'drag'}),navigate=vi.fn(); try {
    f.mount({onNavigate:navigate}); const [first,second]=videos(),a=clock(first!),b=clock(second!,2,false);
    await act(async()=>pointer(f.button(),'pointerdown',0,0)); await act(async()=>pointer(document,'pointermove',60,100)); expect(a.play).toHaveBeenCalledOnce(); await a.sample(1.8); await b.sample(2.3);
    await act(async()=>pointer(document,ending==='cancel'?'pointercancel':'pointerup',ending==='commit'?250:60,1000)); await tick(); expect([a.time,a.paused]).toEqual(ending==='commit'?[1.8,false]:[1.5,true]); expect(a.seeks).toEqual(ending==='commit'?[]:[1.5]); expect([b.time,b.paused,b.seeks]).toEqual([2.3,false,[]]); expect(navigate).not.toHaveBeenCalled(); f.unchanged();
  } finally { f.editor.dispose(); }
});

it('runs an authored after-delay media action once without preparing screens or resetting media',async()=>{
  const f=generated(first=>media(first,'play'),{type:'delay',delay:20}),navigate=vi.fn(); try { f.mount({onNavigate:navigate}); const a=clock(videos()[0]!); await tick(); expect(a.play).toHaveBeenCalledOnce(); await tick(); expect(a.play).toHaveBeenCalledOnce(); expect(a.time).toBe(1.5); expect(a.seeks).toEqual([]); expect(navigate).not.toHaveBeenCalled(); f.unchanged(); } finally { f.editor.dispose(); }
});
