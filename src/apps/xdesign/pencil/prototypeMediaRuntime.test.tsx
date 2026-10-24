import { act } from 'react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { transform } from 'sucrase';
import { createEditor } from '@open-pencil/core/editor';
import { selectionToReact } from './reactExport';
import { serializeGraph } from './document';
import { setPrototypeInteractions } from './prototype';
import { placePreparedVideo, updateVideoAsset, videoAssets } from './videoPaints';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, type DesignInteraction, type DesignNode, type DesignProps } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const back = { action: 'back' as const, transition: 'instant' as const, duration: 0 };
const interactions: DesignInteraction[] = [ { id: 'two', trigger: { type: 'media-hit', time: 2 }, navigation: back }, { id: 'one', trigger: { type: 'media-hit', time: 1 }, navigation: back }, { id: 'late', trigger: { type: 'media-hit', time: 10 }, navigation: back }, { id: 'end', trigger: { type: 'media-end' }, navigation: back } ];
const video: DesignNode = { id: 'video', name: 'video', visible: true, style: { width: 320, height: 180 }, children: [], video: { src: 'data:video/webm;base64,AQID', poster: '', autoplay: false, loop: false, muted: true, controls: true, style: {} }, interactions };
const render = (props: DesignProps = {}, nodes = [video]) => act(() => root.render(<DesignView nodes={nodes} width={320} height={180} {...props} />));
const media = () => host.querySelector('video')!;
const time = (value: number, ended = false, duration = 3) => act(async () => { Object.defineProperties(media(), { currentTime: { configurable: true, value }, duration: { configurable: true, value: duration } }); media().dispatchEvent(new Event(ended ? 'ended' : 'timeupdate')); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(64); });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function generatedVideo(autoplay=false) {
  const editor=createEditor(),graph=editor.graph,screen=graph.createNode('FRAME',editor.state.currentPageId,{name:'Portable video',width:320,height:180,fills:[]});
  const id=placePreparedVideo(editor,{bytes:new Uint8Array([1,2,3]),poster:new Uint8Array([137,80,78,71]),mime:'video/webm',name:'Portable clip',width:320,height:180,duration:3},0,0);graph.reparentNode(id,screen.id);if(autoplay)updateVideoAsset(editor,graph.getNode(id)!,videoAssets(graph.getNode(id)!)[0]!,{autoplay:true});
  setPrototypeInteractions(editor,graph.getNode(id)!,interactions);const before=serializeGraph(graph),delivered: {default?:React.ComponentType<DesignProps>;DesignView?:typeof DesignView;createDesignMediaState?:typeof import('./reactExportRuntime').createDesignMediaState}={};
  const code=transform(selectionToReact(graph,[screen.id]).code,{transforms:['typescript','jsx','imports'],jsxRuntime:'automatic',production:true}).code;
  new Function('require','exports',code)((id:string)=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsxRuntime;throw new Error(`Unexpected generated import ${id}`);},delivered);
  expect(delivered.default).toBeTypeOf('function');expect(delivered.createDesignMediaState).toBeTypeOf('function');const state=delivered.createDesignMediaState!();
  const mount=(props:DesignProps={},strict=false)=>act(()=>{const content=React.createElement(delivered.default!,{mediaState:state,...props});root.render(strict?React.createElement(React.StrictMode,null,content):content);});
  const mountNodes=(nodes:DesignNode[])=>act(()=>root.render(React.createElement(delivered.DesignView!,{nodes,width:320,height:180,mediaState:state})));
  const unchanged=()=>expect(serializeGraph(graph)).toBe(before);return{editor,mount,mountNodes,state,unchanged};
}
function playback(element:HTMLVideoElement,start=1.5,ready=true,initiallyPaused=true){
  let position=start,metadata=ready,paused=initiallyPaused;const seeks:number[]=[];
  Object.defineProperties(element,{currentTime:{configurable:true,get:()=>position,set:(value:number)=>{if(!metadata)throw new DOMException('Metadata not ready','InvalidStateError');position=value;seeks.push(value);}},readyState:{configurable:true,get:()=>metadata?1:0},duration:{configurable:true,get:()=>3},paused:{configurable:true,get:()=>paused}});
  const pause=vi.spyOn(element,'pause').mockImplementation(()=>{paused=true;}),play=vi.spyOn(element,'play').mockImplementation(async()=>{paused=false;});
  return{seeks,pause,play,get time(){return position;},get paused(){return paused;},sample(value:number,ended=false){position=value;return act(async()=>element.dispatchEvent(new Event(ended?'ended':'timeupdate')));},metadata(){metadata=true;return act(async()=>element.dispatchEvent(new Event('loadedmetadata')));}};
}
const commitMedia=(change:()=>void)=>act(async()=>{change();await vi.advanceTimersByTimeAsync(0);});

it('executes the actual portable module media reset without replacing video, source, poster or authored graph',async()=>{
  const fixture=generatedVideo();try{fixture.mount();const video=media(),clock=playback(video),identity=[video.getAttribute('src'),video.getAttribute('poster')];
    await commitMedia(()=>fixture.state.reset());expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(media()).toBe(video);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);expect(clock.paused).toBe(true);
    fixture.mount({values:{unrelated:'typing'}});expect(media()).toBe(video);expect(clock.seeks).toEqual([0]);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('queues a portable reset until metadata is ready and drops that deferred seek after the video unmounts',async()=>{
  const fixture=generatedVideo();try{fixture.mount();const video=media(),clock=playback(video,1.5,false);await commitMedia(()=>fixture.state.reset());expect(clock.time).toBe(1.5);expect(clock.seeks).toEqual([]);await clock.metadata();expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);
    const nextClock=playback(video,2,false);await commitMedia(()=>fixture.state.reset());act(()=>root.render(null));await nextClock.metadata();expect(nextClock.seeks).toEqual([]);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('rearms portable timestamp and end cursors after reset and clears obsolete queued events',async()=>{
  const fixture=generatedVideo(),navigate=vi.fn();try{fixture.mount({onNavigate:navigate,automatic:false});const video=media(),clock=playback(video,0);await clock.sample(3,true);await tick();expect(navigate).not.toHaveBeenCalled();
    await commitMedia(()=>fixture.state.reset());fixture.mount({onNavigate:navigate});await tick();expect(navigate).not.toHaveBeenCalled();expect(clock.time).toBe(0);
    await clock.sample(1.1);await tick();expect(navigate.mock.calls.map(call=>call[2])).toEqual([{type:'media-hit',time:1}]);await clock.sample(3,true);await tick();expect(navigate.mock.calls.map(call=>call[2])).toEqual([{type:'media-hit',time:1},{type:'media-hit',time:2},{type:'media-hit',time:10},{type:'media-end'}]);
    await commitMedia(()=>fixture.state.reset());await clock.sample(1.1);await tick();await clock.sample(3,true);await tick();expect(navigate.mock.calls.map(call=>call[2].type)).toEqual(['media-hit','media-hit','media-hit','media-end','media-hit','media-hit','media-hit','media-end']);await clock.sample(3,true);await tick();expect(navigate).toHaveBeenCalledTimes(8);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it.each([false,true])('restores actual portable playback time, paused=%s and spent trigger cursors from a checkpoint',async paused=>{
  const fixture=generatedVideo(),navigate=vi.fn();try{fixture.mount({onNavigate:navigate});const video=media(),clock=playback(video,0,true,paused);await clock.sample(1.5);await tick();expect(navigate).toHaveBeenCalledOnce();const checkpoint=fixture.state.capture();
    await act(async()=>{if(paused)await clock.play();else clock.pause();});expect(clock.paused).toBe(!paused);
    await commitMedia(()=>fixture.state.reset());expect(clock.time).toBe(0);await clock.sample(2.5);await tick();await commitMedia(()=>fixture.state.restore(checkpoint));expect(clock.time).toBe(1.5);expect(clock.paused).toBe(paused);await clock.sample(1.6);await tick();expect(navigate).toHaveBeenCalledTimes(3);await clock.sample(2.5);await tick();expect(navigate).toHaveBeenCalledTimes(4);expect(navigate.mock.lastCall![2]).toEqual({type:'media-hit',time:2});expect(media()).toBe(video);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('keeps authored autoplay enabled when a pre-metadata portable reset seeks after readiness',async()=>{
  const fixture=generatedVideo(true);try{fixture.mount();const video=media(),clock=playback(video,1.5,false,true);expect(video.autoplay).toBe(true);await commitMedia(()=>fixture.state.reset());expect(clock.seeks).toEqual([]);expect(clock.pause).not.toHaveBeenCalled();await clock.metadata();expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(clock.pause).not.toHaveBeenCalled();expect(video.autoplay).toBe(true);expect(media()).toBe(video);fixture.unchanged();}finally{fixture.editor.dispose();}
});
it.each([false,true])('restores a detached emitted-module checkpoint through StrictMode with metadata ready=%s exactly once',async ready=>{
  const fixture=generatedVideo(),navigate=vi.fn();try{fixture.mount({onNavigate:navigate});const original=media(),clock=playback(original,0,true,false),source=[original.getAttribute('src'),original.getAttribute('poster')];await clock.sample(1.5);await tick();expect(navigate).toHaveBeenCalledOnce();const checkpoint=fixture.state.capture();act(()=>root.render(null));fixture.state.restore(checkpoint);
    let metadata=ready;const positions=new WeakMap<HTMLMediaElement,number>(),paused=new WeakMap<HTMLMediaElement,boolean>(),seeks:{element:HTMLMediaElement;time:number}[]=[];
    vi.spyOn(HTMLMediaElement.prototype,'readyState','get').mockImplementation(()=>metadata?1:0);vi.spyOn(HTMLMediaElement.prototype,'duration','get').mockReturnValue(3);vi.spyOn(HTMLMediaElement.prototype,'currentTime','get').mockImplementation(function(this:HTMLMediaElement){return positions.get(this)??0;});vi.spyOn(HTMLMediaElement.prototype,'currentTime','set').mockImplementation(function(this:HTMLMediaElement,value:number){if(!metadata)throw new DOMException('No metadata','InvalidStateError');positions.set(this,value);seeks.push({element:this,time:value});});vi.spyOn(HTMLMediaElement.prototype,'paused','get').mockImplementation(function(this:HTMLMediaElement){return paused.get(this)??true;});
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function(this:HTMLMediaElement){paused.set(this,true);});vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){paused.set(this,false);});
    fixture.mount({onNavigate:navigate},true);await act(async()=>vi.advanceTimersByTimeAsync(0));const restored=media();expect(restored).not.toBe(original);if(!ready){expect(seeks).toEqual([]);await act(async()=>{metadata=true;restored.dispatchEvent(new Event('loadedmetadata'));await vi.advanceTimersByTimeAsync(0);});}
    expect(restored.currentTime).toBe(1.5);expect(restored.paused).toBe(false);expect(seeks).toEqual([{element:restored,time:1.5}]);expect([restored.getAttribute('src'),restored.getAttribute('poster')]).toEqual(source);positions.set(restored,1.6);await act(async()=>restored.dispatchEvent(new Event('timeupdate')));await tick();expect(navigate).toHaveBeenCalledOnce();positions.set(restored,2.5);await act(async()=>restored.dispatchEvent(new Event('timeupdate')));await tick();expect(navigate).toHaveBeenCalledTimes(2);expect(navigate.mock.lastCall![2]).toEqual({type:'media-hit',time:2});
    metadata=false;await commitMedia(()=>fixture.state.reset());act(()=>root.render(null));await act(async()=>{metadata=true;restored.dispatchEvent(new Event('loadedmetadata'));await vi.advanceTimersByTimeAsync(0);});expect(seeks).toEqual([{element:restored,time:1.5}]);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('does not carry a pending portable seek into a replacement media source with the same logical layer identity',async()=>{
  const fixture=generatedVideo();try{const first={...video,interactions:undefined};fixture.mountNodes([first]);const original=media(),oldClock=playback(original,1.5,false);await commitMedia(()=>fixture.state.reset());expect(oldClock.seeks).toEqual([]);
    const replacement={...first,video:{...first.video!,src:'data:video/webm;base64,BAUG',poster:'data:image/png;base64,BAUG'}};fixture.mountNodes([replacement]);const next=media(),newClock=playback(next,2,false);await oldClock.metadata();await newClock.metadata();await act(async()=>vi.advanceTimersByTimeAsync(0));expect(newClock.time).toBe(2);expect(newClock.seeks).toEqual([]);expect(next.getAttribute('src')).toBe(replacement.video.src);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('retains exact sources when StrictMode initially mounts in a detached host and releases final unmounted media once',async()=>{
  const fixture=generatedVideo();try{host.remove();fixture.mount({},true);await act(async()=>vi.advanceTimersByTimeAsync(0));const video=media();
    expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(['data:video/webm;base64,AQID','data:image/png;base64,iVBORw==']);
    await act(async()=>{document.body.append(host);await vi.advanceTimersByTimeAsync(0);});expect(media()).toBe(video);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(['data:video/webm;base64,AQID','data:image/png;base64,iVBORw==']);
    const pause=vi.spyOn(video,'pause'),load=vi.spyOn(video,'load');await act(async()=>{root.render(null);await vi.advanceTimersByTimeAsync(0);});expect(pause).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledOnce();expect(video.getAttribute('src')).toBeNull();expect(host.childElementCount).toBe(0);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('retains pending playing intent captured while disabled when reset commits before metadata and re-enable',async()=>{
  const fixture=generatedVideo();try{fixture.mount();const original=media(),oldClock=playback(original,1.5,true,false),identity=[original.getAttribute('src'),original.getAttribute('poster')];expect(oldClock.paused).toBe(false);const playing=fixture.state.capture();act(()=>root.render(null));fixture.state.restore(playing);
    fixture.mount({disabled:true});const video=media(),clock=playback(video,0,false,true);await act(async()=>vi.advanceTimersByTimeAsync(0));expect(clock.paused).toBe(true);expect(clock.seeks).toEqual([]);const pending=fixture.state.capture();
    await commitMedia(()=>fixture.state.reset(pending));fixture.mount({disabled:false});expect(clock.seeks).toEqual([]);await clock.metadata();expect(clock.time).toBe(0);expect(clock.paused).toBe(false);expect(clock.seeks).toEqual([0]);expect(media()).toBe(video);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);fixture.unchanged();
  }finally{fixture.editor.dispose();}
});
it('orders reached timestamps, fires beyond-duration hits at the end and then fires end once', async () => {
  const navigate = vi.fn(); render({ onNavigate: navigate }); await time(0.9); expect(navigate).not.toHaveBeenCalled(); await time(2.1); await tick(); expect(navigate.mock.calls.map(call => call[2])).toEqual([{ type: 'media-hit', time: 1 }, { type: 'media-hit', time: 2 }]);
  await time(3, true); await tick(); expect(navigate.mock.calls.map(call => call[2])).toEqual([{ type: 'media-hit', time: 1 }, { type: 'media-hit', time: 2 }, { type: 'media-hit', time: 10 }, { type: 'media-end' }]); await time(3, true); await tick(); expect(navigate).toHaveBeenCalledTimes(4);
});
it('waits for asynchronous navigation while retaining crossed timestamps', async () => {
  let resolve!: () => void; const pending = new Promise<void>(yes => { resolve = yes; }), navigate = vi.fn().mockReturnValueOnce(pending); render({ onNavigate: navigate }); await time(1.1); await time(2.2); await time(3, true); await tick(); expect(navigate).toHaveBeenCalledOnce();
  await act(async () => resolve()); await tick(); expect(navigate.mock.calls.map(call => call[2].type)).toEqual(['media-hit', 'media-hit', 'media-hit', 'media-end']);
});
it('rearms on rewind and skips completed timestamps that precede the new playhead', async () => {
  const navigate = vi.fn(); render({ onNavigate: navigate }); await time(2.5); await tick(); expect(navigate).toHaveBeenCalledTimes(2); await time(1.5); await tick(); expect(navigate).toHaveBeenCalledTimes(2); await time(2.5); await tick(); expect(navigate).toHaveBeenCalledTimes(3);
  await time(0); await time(1.1); await tick(); expect(navigate).toHaveBeenCalledTimes(4); expect(navigate.mock.calls[3]![2]).toEqual({ type: 'media-hit', time: 1 });
});
it('retains pending end events while automatic playback is suspended and resumes without duplicates', async () => {
  const navigate = vi.fn(); render({ onNavigate: navigate, automatic: false }); await time(3, true); await tick(); expect(navigate).not.toHaveBeenCalled(); render({ onNavigate: navigate }); await tick(); expect(navigate).toHaveBeenCalledTimes(4); render({ onNavigate: navigate, automatic: false }); render({ onNavigate: navigate }); await tick(); expect(navigate).toHaveBeenCalledTimes(4);
});
it('uses the actual video frame clock when available and cancels the callback on disable', async () => {
  let callback!: VideoFrameRequestCallback; const request = vi.fn((next: VideoFrameRequestCallback) => { callback = next; return 7; }), cancel = vi.fn(); Object.defineProperties(HTMLVideoElement.prototype, { requestVideoFrameCallback: { configurable: true, value: request }, cancelVideoFrameCallback: { configurable: true, value: cancel } });
  try { const navigate = vi.fn(); render({ onNavigate: navigate }); Object.defineProperty(media(), 'duration', { configurable: true, value: 3 }); await act(async () => callback(100, { mediaTime: 1.2 } as VideoFrameCallbackMetadata)); expect(navigate).toHaveBeenCalledOnce(); render({ onNavigate: navigate, disabled: true }); expect(cancel).toHaveBeenCalledWith(7); }
  finally { delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback; delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback; }
});
it('never delivers pending events after unmount or navigation rejection', async () => {
  const navigate = vi.fn().mockRejectedValueOnce(new Error('Unavailable')), error = vi.fn(); render({ onNavigate: navigate, onPrototypeError: error }); await time(1.2); expect(error).toHaveBeenCalledWith('Error: Unavailable'); await time(1.3); expect(navigate).toHaveBeenCalledOnce(); render({}, []); await tick(); expect(navigate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
