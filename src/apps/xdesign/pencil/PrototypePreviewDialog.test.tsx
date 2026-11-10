import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import * as reactExport from './reactExport';
import { PrototypePreviewDialog } from './PrototypePreviewDialog';
import { usePencilWorkspace } from './runtime';
import * as pencilRuntime from './runtime';
import { setPrototypeInteractions, setNavigation, setPrototypeStart, type DesignNavigation } from './prototype';
import { setComponentBehaviour } from './behaviour/editor';
import { createComponentProperty, bindComponentProperty } from './componentProperties';
import { serializeGraph } from './document';
import { xdesignProjectChangeReason, clearXDesignActivities } from '../runtimeActivity';
import { setPrototypeOverlay } from './prototypeOverlay';
import { placePreparedVideo } from './videoPaints';
vi.mock('./runtime', async original => ({ ...await original<typeof import('./runtime')>(), initializeCanvasKit: async () => undefined }));
let editor: Editor, root: Root, host: HTMLDivElement, first: string, second: string, close: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  editor = createEditor(); const graph = editor.graph, page = editor.state.currentPageId;
  first = graph.createNode('FRAME', page, { name: 'Home', width: 320, height: 480 }).id;
  second = graph.createNode('FRAME', page, { name: 'Details', x: 400, width: 320, height: 480 }).id;
  const hotspot = graph.createNode('TEXT', first, { name: 'Next screen', text: 'Continue', width: 100, height: 30 });
  setNavigation(editor, hotspot, { action: 'navigate', target: second, transition: 'dissolve', duration: 200 }); setPrototypeStart(editor, first);
  const main = graph.createNode('COMPONENT', page, { name: 'Check', width: 40, height: 40 });
  const mark = graph.createNode('RECTANGLE', main.id, { name: 'Check mark', width: 10, height: 10, visible: false });
  const value = createComponentProperty(editor, main, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', value);
  setComponentBehaviour(editor, main, { kind: 'checkbox', values: { value: 'Checked' } }); graph.createInstance(main.id, first, { x: 20, y: 100 });
  usePencilWorkspace.setState({ editor, busy: false }); host = document.createElement('div'); host.className = 'xd-pencil'; document.body.append(host); root = createRoot(host); close = vi.fn();
});

function overlayScreens(withControls = false) {
  const graph = editor.graph, page = editor.state.currentPageId;
  const modal = graph.createNode('FRAME', page, { name: 'Modal', width: 160, height: 120 }), nested = graph.createNode('FRAME', page, { name: 'Nested', width: 80, height: 60 }), replacement = graph.createNode('FRAME', page, { name: 'Replacement', width: 140, height: 100 });
  const open = graph.getNode(first)!.childIds.map(id => graph.getNode(id)!).find(node => node.name === 'Next screen')!;
  setNavigation(editor, open, { action: 'overlay', target: modal.id, transition: 'dissolve', duration: 200 });
  const hotspot = (parent: string, name: string, action: 'overlay' | 'swap' | 'close' | 'navigate', target?: string) => { const node = graph.createNode('TEXT', parent, { name, text: name, width: 60, height: 20 }); setNavigation(editor, node, { action, target, transition: 'instant', duration: 0 }); return node; };
  hotspot(modal.id, 'Open nested', 'overlay', nested.id); hotspot(modal.id, 'Go to Details', 'navigate', second);
  if (withControls) {
    hotspot(modal.id, 'Open same overlay', 'overlay', modal.id);
    const resetOccurrence = graph.createNode('TEXT', modal.id, { name: 'Reset same overlay', text: 'Reset same overlay', width: 80, height: 20 });
    setNavigation(editor, resetOccurrence, { action: 'overlay', target: modal.id, transition: 'instant', duration: 0, resetInteractiveComponents: true });
    const checkboxComponent = [...graph.nodes.values()].find(node => node.type === 'COMPONENT' && node.name === 'Check')!; graph.createInstance(checkboxComponent.id, modal.id, { x: 20, y: 40 });
  }
  hotspot(nested.id, 'Swap nested', 'swap', replacement.id); hotspot(replacement.id, 'Dismiss', 'close');
  setPrototypeOverlay(editor, modal, { position: 'bottom-right', closeOutside: true, background: { r: 0, g: 0, b: 0, a: 0.5 } });
  return { modal, nested, replacement, open, hotspot };
}
const hotspot = (name: string) => [...host.querySelectorAll<HTMLElement>('[data-name]')].find(node => node.getAttribute('data-name') === name)!;

function addPresentVideo(parent=first,name='Present retained clip') {
  const id=placePreparedVideo(editor,{bytes:new Uint8Array([1,2,3]),poster:new Uint8Array([137,80,78,71]),mime:'video/webm',name,width:80,height:45,duration:3},10,180);editor.graph.reparentNode(id,parent);return editor.graph.getNode(id)!;
}
function presentClock(video:HTMLVideoElement,time=1.5,ready=true,paused=true) {
  let position=time,metadata=ready,stopped=paused;const seeks:number[]=[];
  Object.defineProperties(video,{currentTime:{configurable:true,get:()=>position,set:(next:number)=>{if(!metadata)throw new DOMException('No metadata','InvalidStateError');position=next;seeks.push(next);}},readyState:{configurable:true,get:()=>metadata?1:0},duration:{configurable:true,get:()=>3},paused:{configurable:true,get:()=>stopped}});
  const pause=vi.fn(()=>{stopped=true;}),play=vi.fn(async()=>{stopped=false;});Object.defineProperties(video,{pause:{configurable:true,writable:true,value:pause},play:{configurable:true,writable:true,value:play}});
  return{seeks,pause,play,get time(){return position;},get paused(){return stopped;},metadata:()=>act(async()=>{metadata=true;video.dispatchEvent(new Event('loadedmetadata'));}),sample:(next:number,ended=false)=>act(async()=>{position=next;video.dispatchEvent(new Event(ended?'ended':'timeupdate'));})};
}

it('Present targeted Play Pause and Toggle preserve actual media, route, graph and prepared model identity',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  const clip=addPresentVideo(),other=addPresentVideo(first,'Untouched second clip');
  for(const operation of ['play','pause','toggle'] as const){const node=editor.graph.createNode('TEXT',first,{name:`Transport ${operation}`,text:operation,width:100,height:24});setNavigation(editor,node,{action:'media',mediaAction:operation,target:clip.id,transition:'instant',duration:0});}
  const before=serializeGraph(editor.graph),canUndo=editor.undo.canUndo;await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const view=host.querySelector('[data-xdesign-view]'),videos=[...host.querySelectorAll<HTMLVideoElement>('video')],video=videos[0]!,clock=presentClock(video),otherClock=presentClock(videos[1]!,2,true,false),identity=[video.getAttribute('src'),video.getAttribute('poster')],prepare=vi.spyOn(reactExport,'selectionToDesignModel');
  expect(clock.pause).not.toBe(otherClock.pause);expect(clock.play).not.toBe(otherClock.play);
  await act(async()=>hotspot('Transport play').click());expect(clock.paused).toBe(false);await act(async()=>hotspot('Transport pause').click());expect(clock.paused).toBe(true);await act(async()=>hotspot('Transport toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(clock.paused).toBe(false);
  expect(clock.play).toHaveBeenCalledTimes(2);expect(clock.pause).toHaveBeenCalledOnce();expect(otherClock.play).not.toHaveBeenCalled();expect(otherClock.pause).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(host.querySelector('[data-xdesign-view]')).toBe(view);expect(host.querySelector('video')).toBe(video);expect([clock.time,clock.seeks]).toEqual([1.5,[]]);expect([otherClock.time,otherClock.paused,otherClock.seeks]).toEqual([2,false,[]]);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(serializeGraph(editor.graph)).toBe(before);expect(editor.undo.canUndo).toBe(canUndo);expect(other.id).not.toBe(clip.id);expect(close).not.toHaveBeenCalled();
});

it('Present rejected targeted Play stops its following route without screen preparation or media reset',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const clip=addPresentVideo(),node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;
  setNavigation(editor,node,{action:'sequence',transition:'instant',duration:0,actions:[{action:'media',mediaAction:'play',target:clip.id,transition:'instant',duration:0},{action:'navigate',target:second,transition:'instant',duration:0}]});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video),view=host.querySelector('[data-xdesign-view]'),prepare=vi.spyOn(reactExport,'selectionToDesignModel');vi.mocked(video.play).mockRejectedValue(new Error('Present playback refused'));
  await act(async()=>hotspot('Next screen').click());expect(host.querySelector('[role=alert]')?.textContent).toContain('Present playback refused');expect(prepare).not.toHaveBeenCalled();expect(host.querySelector('[data-xdesign-view]')).toBe(view);expect(host.querySelector('h2')?.textContent).toBe('Home');expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,true,[]]);expect(serializeGraph(editor.graph)).toBe(before);
});

it('Present repeated overlay targeted media controls only the top occurrence and leaves lower/base playheads unchanged',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const {modal}=overlayScreens(true);addPresentVideo(first,'Base clip');const clip=addPresentVideo(modal.id,'Repeated overlay clip'),node=editor.graph.createNode('TEXT',modal.id,{name:'Play overlay clip',text:'Play',width:100,height:24});setNavigation(editor,node,{action:'media',mediaAction:'play',target:clip.id,transition:'instant',duration:0});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const base=host.querySelector('video')!,baseClock=presentClock(base);await act(async()=>hotspot('Next screen').click());const lower=host.querySelector<HTMLVideoElement>('.xd-prototype-overlay-frame video')!,lowerClock=presentClock(lower,2);await act(async()=>hotspot('Open same overlay').click());const overlays=host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame'),top=overlays[1]!.querySelector<HTMLVideoElement>('video')!,topClock=presentClock(top,2.5),prepare=vi.spyOn(reactExport,'selectionToDesignModel');
  await act(async()=>overlays[1]!.querySelector<HTMLElement>('[data-name="Play overlay clip"]')!.click());expect(topClock.paused).toBe(false);expect([topClock.time,topClock.seeks]).toEqual([2.5,[]]);expect([lowerClock.time,lowerClock.paused,lowerClock.seeks]).toEqual([2,true,[]]);expect([baseClock.time,baseClock.paused,baseClock.seeks]).toEqual([1.5,true,[]]);expect(prepare).not.toHaveBeenCalled();expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(2);expect(overlays[0]!.querySelector('video')).toBe(lower);expect(serializeGraph(editor.graph)).toBe(before);
});

it('Present sequences resolve media against the committed arriving screen after navigation',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined);addPresentVideo(first,'Outgoing clip');const arriving=addPresentVideo(second,'Arriving clip'),node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;setNavigation(editor,node,{action:'sequence',transition:'instant',duration:0,actions:[{action:'navigate',target:second,transition:'instant',duration:0},{action:'media',mediaAction:'play',target:arriving.id,transition:'instant',duration:0}]});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const outgoing=host.querySelector('video')!;await act(async()=>hotspot('Next screen').click());const video=host.querySelector('video')!;expect(video).not.toBe(outgoing);expect(host.querySelector('h2')?.textContent).toBe('Details');expect(play).toHaveBeenCalledOnce();expect(play.mock.instances[0]).toBe(video);expect(video.currentTime).toBe(0);expect(host.querySelector('[role=alert]')).toBeNull();expect(serializeGraph(editor.graph)).toBe(before);
});

it.each([undefined,false,true])('Present Open link newTab=%s leaves overlay, controls, scroll and actual video playback intact',async flag=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const {modal}=overlayScreens(true);
  const url='https://example.com/present-review?view=canvas#thread',node=editor.graph.createNode('TEXT',modal.id,{name:'Present external review',text:'External review',width:100,height:24});setNavigation(editor,node,{action:'open-url',url,...(flag===undefined?{}:{newTab:flag}),transition:'instant',duration:0});
  const before=serializeGraph(editor.graph),canUndo=editor.undo.canUndo,open=vi.fn();await act(async()=>root.render(<PrototypePreviewDialog close={close} onOpenUrl={open}/>));await act(async()=>hotspot('Next screen').click());
  const modalView=host.querySelector<HTMLElement>('.xd-prototype-overlay-frame')!,checkbox=modalView.querySelector<HTMLElement>('[role="checkbox"]')!;await act(async()=>checkbox.click());const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false),identity=[video.getAttribute('src'),video.getAttribute('poster')];const viewport=modalView.querySelector<HTMLElement>('[data-xdesign-view]')!;viewport.scrollLeft=13;viewport.scrollTop=79;
  const button=hotspot('Present external review');await act(async()=>button.click());await act(async()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(open.mock.calls).toEqual([[url,flag??true],[url,flag??true]]);expect(host.querySelector('.xd-prototype-overlay-frame')).toBe(modalView);expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(1);expect(modalView.querySelector('[role="checkbox"]')).toBe(checkbox);expect(checkbox.getAttribute('aria-checked')).toBe('true');expect([viewport.scrollLeft,viewport.scrollTop]).toEqual([13,79]);expect(host.querySelector('video')).toBe(video);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(identity);expect(close).not.toHaveBeenCalled();expect(serializeGraph(editor.graph)).toBe(before);expect(editor.undo.canUndo).toBe(canUndo);
});

it.each(['false','reject'] as const)('Present URL callback %s stops a mixed sequence before navigation and preserves source and playback',async failure=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;setNavigation(editor,node,{action:'sequence',transition:'instant',duration:0,actions:[{action:'open-url',url:'mailto:present-review@example.com',newTab:false,transition:'instant',duration:0},{action:'navigate',target:second,transition:'instant',duration:0}]});
  const before=serializeGraph(editor.graph),open=vi.fn(()=>failure==='false'?false:Promise.reject(new Error('Present URL unavailable')));await act(async()=>root.render(<PrototypePreviewDialog close={close} onOpenUrl={open}/>));const view=host.querySelector('[data-xdesign-view]'),video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false);await act(async()=>hotspot('Next screen').click());
  expect(open.mock.calls).toEqual([['mailto:present-review@example.com',false]]);expect(host.querySelector('[data-xdesign-view]')).toBe(view);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(host.querySelector('video')).toBe(video);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();expect(serializeGraph(editor.graph)).toBe(before);expect(close).not.toHaveBeenCalled();
});

it('Present Stop actions invalidates a pending URL completion before its next route step without touching media',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;setNavigation(editor,node,{action:'sequence',transition:'instant',duration:0,actions:[{action:'open-url',url:'https://example.com/pending',transition:'instant',duration:0},{action:'navigate',target:second,transition:'instant',duration:0}]});
  let resolve!:(accepted:boolean)=>void;const open=vi.fn(()=>new Promise<boolean>(yes=>{resolve=yes;})),before=serializeGraph(editor.graph);await act(async()=>root.render(<PrototypePreviewDialog close={close} onOpenUrl={open}/>));const view=host.querySelector('[data-xdesign-view]'),video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false);await act(async()=>hotspot('Next screen').click());expect(open).toHaveBeenCalledOnce();expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);await act(async()=>button('Stop actions').click());await act(async()=>resolve(true));expect(host.querySelector('[data-xdesign-view]')).toBe(view);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(host.querySelector('video')).toBe(video);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);expect(serializeGraph(editor.graph)).toBe(before);expect(close).not.toHaveBeenCalled();
});

it('Present awaits an accepted URL before committing the next navigation exactly once',async()=>{
  const node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;setNavigation(editor,node,{action:'sequence',transition:'instant',duration:0,actions:[{action:'open-url',url:'https://example.com/before-details',newTab:false,transition:'instant',duration:0},{action:'navigate',target:second,transition:'instant',duration:0}]});
  let resolve!:(accepted:boolean)=>void;const open=vi.fn(()=>new Promise<boolean>(yes=>{resolve=yes;})),before=serializeGraph(editor.graph);await act(async()=>root.render(<PrototypePreviewDialog close={close} onOpenUrl={open}/>));const view=host.querySelector('[data-xdesign-view]');await act(async()=>hotspot('Next screen').click());expect(open.mock.calls).toEqual([['https://example.com/before-details',false]]);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(host.querySelector('[data-xdesign-view]')).toBe(view);await act(async()=>resolve(true));expect(host.querySelector('h2')?.textContent).toBe('Details');expect(open).toHaveBeenCalledOnce();expect(serializeGraph(editor.graph)).toBe(before);await act(async()=>button('Back').click());expect(host.querySelector('h2')?.textContent).toBe('Home');expect(button('Back').disabled).toBe(true);
});

it.each(['refusal','cancel-pending'] as const)('Present mixed drag URL prefix %s never starts preparation, pauses or restores media',async mode=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const node=editor.graph.getChildren(first).find(child=>child.name==='Next screen')!;setPrototypeInteractions(editor,node,[{id:'mixed-url-drag',trigger:{type:'drag'},navigation:{action:'sequence',transition:'instant',duration:0,actions:[{action:'open-url',url:'https://example.com/drag-prefix',transition:'instant',duration:0},{action:'navigate',target:second,transition:'instant',duration:0}]}}]);
  let resolve!:(accepted:boolean)=>void;const open=vi.fn(()=>new Promise<boolean>(yes=>{resolve=yes;})),before=serializeGraph(editor.graph),prepare=vi.spyOn(reactExport,'selectionToDesignModel');await act(async()=>root.render(<PrototypePreviewDialog close={close} onOpenUrl={open}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false),pause=vi.mocked(video.pause),prepared=prepare.mock.calls.length,pauses=pause.mock.calls.length,view=host.querySelector('[data-xdesign-view]');
  await act(async()=>dragPointer(hotspot('Next screen'),'pointerdown',40,0));await act(async()=>dragPointer(document,'pointermove',80,100));expect(open).toHaveBeenCalledOnce();expect(prepare).toHaveBeenCalledTimes(prepared);expect(pause).toHaveBeenCalledTimes(pauses);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);
  if(mode==='refusal')await act(async()=>resolve(false));await act(async()=>dragPointer(document,'pointercancel',80,200));if(mode==='cancel-pending')await act(async()=>resolve(true));
  expect(open).toHaveBeenCalledOnce();expect(prepare).toHaveBeenCalledTimes(prepared);expect(pause).toHaveBeenCalledTimes(pauses);expect(host.querySelector('[data-xdesign-view]')).toBe(view);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(host.querySelector('video')).toBe(video);expect([clock.time,clock.paused,clock.seeks]).toEqual([1.5,false,[]]);expect(serializeGraph(editor.graph)).toBe(before);
});

it.each([undefined,false,true])('Present same-screen resetVideoPosition=%s preserves the actual media node and resets only when requested',async flag=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();
  const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'instant',duration:0,...(flag===undefined?{}:{resetVideoPosition:flag})});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video),attributes=[video.getAttribute('src'),video.getAttribute('poster')];await act(async()=>hotspot('Next screen').click());
  expect(clock.time).toBe(flag?0:1.5);expect(clock.paused).toBe(true);expect(host.querySelector('video')).toBe(video);expect([video.getAttribute('src'),video.getAttribute('poster')]).toEqual(attributes);expect(host.querySelector('h2')?.textContent).toBe('Home');expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present same-screen reset preserves initially playing intent across busy preparation',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'instant',duration:0,resetVideoPosition:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false);await act(async()=>hotspot('Next screen').click());expect(clock.time).toBe(0);expect(clock.paused).toBe(false);expect(host.querySelector('video')).toBe(video);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present defers a successful same-screen video reset until metadata without replacing its media',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'instant',duration:0,resetVideoPosition:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,false);await act(async()=>hotspot('Next screen').click());expect(clock.seeks).toEqual([]);expect(clock.time).toBe(1.5);await clock.metadata();expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(host.querySelector('video')).toBe(video);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present leaves playback untouched after reset preparation failure and resets on a successful retry',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'instant',duration:0,resetVideoPosition:true,resetInteractiveComponents:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false),original=reactExport.selectionToDesignModel;let fail=true;
  vi.spyOn(reactExport,'selectionToDesignModel').mockImplementation((...args)=>{if(fail&&args[1][0]===first){fail=false;throw new Error('Video reset preparation failed');}return original(...args);});
  await act(async()=>hotspot('Next screen').click());expect(host.querySelector('[role=alert]')?.textContent).toContain('Video reset preparation failed');expect(clock.time).toBe(1.5);expect(clock.paused).toBe(false);expect(clock.seeks).toEqual([]);expect(host.querySelector('video')).toBe(video);
  await act(async()=>hotspot('Next screen').click());expect(clock.time).toBe(0);expect(clock.paused).toBe(false);expect(host.querySelector('video')).toBe(video);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present rejects a canceled preparation without a late seek after its dialog is unmounted',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'instant',duration:0,resetVideoPosition:true,resetInteractiveComponents:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video);let finish!:(value:undefined)=>void;vi.spyOn(pencilRuntime,'initializeCanvasKit').mockReturnValue(new Promise<undefined>(done=>{finish=done;}) as unknown as ReturnType<typeof pencilRuntime.initializeCanvasKit>);
  await act(async()=>hotspot('Next screen').click());expect(clock.seeks).toEqual([]);act(()=>root.render(null));await act(async()=>finish(undefined));expect(clock.seeks).toEqual([]);expect(clock.time).toBe(1.5);expect(host.childElementCount).toBe(0);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present resets only the arriving repeated overlay media and retains base/lower occurrence playback',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const {modal}=overlayScreens(true);addPresentVideo(first,'Base retained video');addPresentVideo(modal.id,'Overlay occurrence video');
  const reset=editor.graph.getChildren(modal.id).find(node=>node.name==='Reset same overlay')!;setNavigation(editor,reset,{action:'overlay',target:modal.id,transition:'instant',duration:0,resetVideoPosition:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const base=host.querySelector<HTMLVideoElement>('.xd-prototype-screen video')!,baseClock=presentClock(base,1.5);await act(async()=>hotspot('Next screen').click());
  const lower=host.querySelector<HTMLVideoElement>('.xd-prototype-overlay-frame video')!,lowerClock=presentClock(lower,2);await act(async()=>hotspot('Reset same overlay').click());const frames=host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame');expect(frames).toHaveLength(2);
  const top=frames[1]!.querySelector<HTMLVideoElement>('video')!;expect(top).not.toBe(lower);expect(top.currentTime).toBe(0);expect(baseClock.time).toBe(1.5);expect(lowerClock.time).toBe(2);expect(frames[0]!.querySelector('video')).toBe(lower);expect(base.getAttribute('src')).toBe(lower.getAttribute('src'));expect(serializeGraph(editor.graph)).toBe(before);
});
it.each([false,true])('Present Back resetVideoPosition=%s applies to the arriving screen through the actual authored handler',async reset=>{
  const positions=new WeakMap<HTMLMediaElement,number>(),seeks:{element:HTMLMediaElement;time:number}[]=[];
  vi.spyOn(HTMLMediaElement.prototype,'currentTime','get').mockImplementation(function(this:HTMLMediaElement){return positions.get(this)??1.5;});vi.spyOn(HTMLMediaElement.prototype,'currentTime','set').mockImplementation(function(this:HTMLMediaElement,value:number){positions.set(this,value);seeks.push({element:this,time:value});});vi.spyOn(HTMLMediaElement.prototype,'readyState','get').mockReturnValue(1);vi.spyOn(HTMLMediaElement.prototype,'paused','get').mockReturnValue(true);vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  addPresentVideo(first,'Back home clip');addPresentVideo(second,'Back details clip');const back=editor.graph.createNode('TEXT',second,{name:'Authored video Back',text:'Back',width:80,height:24});setNavigation(editor,back,{action:'back',transition:'instant',duration:0,resetVideoPosition:reset});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));await act(async()=>hotspot('Next screen').click());expect(host.querySelector('h2')?.textContent).toBe('Details');const outgoing=host.querySelector('video')!;expect(outgoing.currentTime).toBe(1.5);
  await act(async()=>hotspot('Authored video Back').click());expect(host.querySelector('h2')?.textContent).toBe('Home');const arriving=host.querySelector('video')!;expect(arriving.currentTime).toBe(reset?0:1.5);expect(seeks.filter(item=>item.element===arriving&&item.time===0)).toHaveLength(reset?1:0);expect(outgoing.currentTime).toBe(1.5);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present authored Close resets the arriving lower overlay then base without changing other playback or controls',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});const {modal}=overlayScreens(true);addPresentVideo(first,'Close base clip');addPresentVideo(modal.id,'Close overlay clip');
  const closeAction=editor.graph.createNode('TEXT',modal.id,{name:'Authored video Close',text:'Close',width:80,height:20});setNavigation(editor,closeAction,{action:'close',transition:'instant',duration:0,resetVideoPosition:true});const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const base=host.querySelector('video')!,baseClock=presentClock(base,1.5),baseCheck=host.querySelector<HTMLElement>('.xd-prototype-screen [role=checkbox]')!;act(()=>baseCheck.click());await act(async()=>hotspot('Next screen').click());
  const lowerFrame=host.querySelector<HTMLElement>('.xd-prototype-overlay-frame')!,lower=lowerFrame.querySelector('video')!,lowerClock=presentClock(lower,2),lowerCheck=lowerFrame.querySelector<HTMLElement>('[role=checkbox]')!;act(()=>lowerCheck.click());await act(async()=>hotspot('Open same overlay').click());
  const topFrame=host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[1]!,top=topFrame.querySelector('video')!,topClock=presentClock(top,2.5);await act(async()=>topFrame.querySelector<HTMLElement>('[data-name="Authored video Close"]')!.click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(1);expect(lowerClock.time).toBe(0);expect(baseClock.time).toBe(1.5);expect(topClock.time).toBe(2.5);expect(lowerCheck.getAttribute('aria-checked')).toBe('true');expect(baseCheck.getAttribute('aria-checked')).toBe('true');
  await act(async()=>hotspot('Authored video Close').click());expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(0);expect(baseClock.time).toBe(0);expect(baseCheck.getAttribute('aria-checked')).toBe('true');expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present commits a noninstant reset before animation completion without replacing or re-seeking the video later',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setNavigation(editor,opener,{action:'navigate',target:first,transition:'dissolve',duration:100,resetVideoPosition:true});const before=serializeGraph(editor.graph),animation=dragMotion();
  try{await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video);await act(async()=>hotspot('Next screen').click());expect(animation.jobs.length).toBeGreaterThan(0);expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(host.querySelector('video')).toBe(video);expect(animation.jobs.every(job=>job.cancel.mock.calls.length===0)).toBe(true);
    await act(async()=>animation.jobs.forEach(job=>job.finish()));expect(clock.time).toBe(0);expect(clock.seeks).toEqual([0]);expect(serializeGraph(editor.graph)).toBe(before);
  }finally{animation.restore();}
});
it('Present held same-screen reset restores actual playing time when the press lease releases',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setPrototypeInteractions(editor,opener,[{id:'held-video-reset',trigger:{type:'press'},navigation:{action:'navigate',target:first,transition:'instant',duration:0,resetVideoPosition:true}}]);const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false);await act(async()=>heldPointer(hotspot('Next screen'),'pointerdown',4));expect(clock.time).toBe(0);await act(async()=>heldPointer(document,'pointerup',4));expect(clock.time).toBe(1.5);expect(clock.paused).toBe(false);expect(host.querySelector('video')).toBe(video);expect(serializeGraph(editor.graph)).toBe(before);
});
it('Present canceled same-screen drag restores actual time and playing state after a committed temporary reset',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});addPresentVideo();const opener=editor.graph.getChildren(first).find(node=>node.name==='Next screen')!;setPrototypeInteractions(editor,opener,[{id:'drag-video-reset',trigger:{type:'drag'},navigation:{action:'navigate',target:first,transition:'dissolve',duration:100,resetVideoPosition:true}}]);const before=serializeGraph(editor.graph),animation=dragMotion();
  try{await act(async()=>root.render(<PrototypePreviewDialog close={close}/>));const video=host.querySelector('video')!,clock=presentClock(video,1.5,true,false);await act(async()=>dragPointer(hotspot('Next screen'),'pointerdown',40,0));await act(async()=>dragPointer(document,'pointermove',80,100));expect(clock.time).toBe(0);await act(async()=>dragPointer(document,'pointercancel',80,200));expect(clock.time).toBe(1.5);expect(clock.paused).toBe(false);expect(host.querySelector('video')).toBe(video);expect(serializeGraph(editor.graph)).toBe(before);
  }finally{animation.restore();}
});
it.each(['finish', 'setup failure'] as const)('plays Smart Animate through the actual Present controller and recovers on %s without changing the source', async mode => {
  const graph = editor.graph, opener = graph.getChildren(first).find(node => node.name === 'Next screen')!;
  setNavigation(editor, opener, { action: 'navigate', target: second, transition: 'smart', duration: 300, easing: 'linear' });
  graph.createNode('RECTANGLE', first, { name: 'Matched card', x: 20, y: 40, width: 40, height: 30 }); graph.createNode('RECTANGLE', second, { name: 'Matched card', x: 100, y: 60, width: 80, height: 30 });
  const before = serializeGraph(graph), original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate'), jobs: { node: HTMLElement; frames: Keyframe[]; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[]) { if (mode === 'setup failure') throw new Error('Smart animation setup failed'); let finish!: () => void; const cancel = vi.fn(), finished = new Promise<void>(resolve => { finish = resolve; }); jobs.push({ node: this, frames, finish, cancel }); return { finished, cancel }; } });
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Details');
    if (mode === 'finish') { const card = jobs.find(job => job.node.getAttribute('data-name') === 'Matched card')!; expect(card.frames[0]!.transform).toContain('matrix(0.5,0,0,1,-80,-20)'); expect(card.frames.at(-1)!.transform).toContain('matrix(1,0,0,1,0,0)'); expect(host.querySelector('[data-xdesign-snapshot]')).not.toBeNull(); await act(async () => jobs.forEach(job => job.finish())); expect(jobs.every(job => job.cancel.mock.calls.length === 1)).toBe(true); }
    else expect(host.querySelector('[role=alert]')?.textContent).toContain('Smart animation setup failed');
    expect(host.querySelector('[data-xdesign-snapshot],[data-xdesign-motion-paint]')).toBeNull(); expect(serializeGraph(graph)).toBe(before); await act(async () => button('Restart').click()); expect(host.querySelector('h2')?.textContent).toBe('Home');
  } finally { if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); }
});
it('stacks dialogs, swaps only the top one, keeps underlays inert and returns focus and control values on dismissal', async () => {
  overlayScreens(); const before = serializeGraph(editor.graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const checkbox = host.querySelector('[role=checkbox]') as HTMLButtonElement; act(() => checkbox.click());
  const opener = hotspot('Next screen'); opener.focus(); await act(async () => opener.click());
  expect(host.querySelector('h2')?.textContent).toBe('Modal'); expect(host.querySelector('.xd-prototype-content')?.hasAttribute('inert')).toBe(true); expect(checkbox.disabled).toBe(true); expect(document.activeElement?.closest('.xd-prototype-overlay')).not.toBeNull();
  const modalFrame = host.querySelector<HTMLElement>('.xd-prototype-overlay-frame')!; expect(modalFrame.style.left).toBe('160px'); expect(modalFrame.style.top).toBe('360px');
  const nestedOpener = hotspot('Open nested'); nestedOpener.focus(); await act(async () => nestedOpener.click());
  expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(2); expect(host.querySelector('.xd-prototype-overlay')?.hasAttribute('inert')).toBe(true);
  await act(async () => hotspot('Swap nested').click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(2); expect(host.querySelector('h2')?.textContent).toBe('Replacement'); expect(button('Back').disabled).toBe(true);
  await act(async () => hotspot('Dismiss').click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1); expect(document.activeElement).toBe(nestedOpener); expect(host.querySelector('h2')?.textContent).toBe('Modal');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(document.activeElement).toBe(opener); expect(checkbox.getAttribute('aria-checked')).toBe('true'); expect(checkbox.disabled).toBe(false); expect(close).not.toHaveBeenCalled();
  expect(serializeGraph(editor.graph)).toBe(before);
});
it('resets only the successfully entered destination screen controls when requested', async () => {
  const graph = editor.graph, component = [...graph.nodes.values()].find(node => node.type === 'COMPONENT' && node.name === 'Check')!;
  graph.createInstance(component.id, second, { x: 20, y: 100 });
  const back = graph.createNode('TEXT', second, { name: 'Return home', text: 'Return', width: 80, height: 24 });
  setNavigation(editor, back, { action: 'navigate', target: first, transition: 'instant', duration: 0 });
  const reset = graph.createNode('TEXT', first, { name: 'Reset Details', text: 'Reset details', width: 100, height: 24 });
  setNavigation(editor, reset, { action: 'navigate', target: second, transition: 'instant', duration: 0, resetInteractiveComponents: true });
  const before = serializeGraph(graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const homeCheckbox = host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')!;
  act(() => homeCheckbox.click()); expect(homeCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Next screen').click());
  const detailsCheckbox = host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')!;
  act(() => detailsCheckbox.click()); expect(detailsCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Return home').click());
  expect(host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Reset Details').click());
  expect(host.querySelector('h2')?.textContent).toBe('Details');
  expect(host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
  expect(serializeGraph(graph)).toBe(before);
});
it('keeps destination control state intact when a reset transition fails, then resets on retry', async () => {
  const graph = editor.graph, component = [...graph.nodes.values()].find(node => node.type === 'COMPONENT' && node.name === 'Check')!;
  graph.createInstance(component.id, second, { x: 20, y: 100 });
  const back = graph.createNode('TEXT', second, { name: 'Return home', text: 'Return', width: 80, height: 24 });
  setNavigation(editor, back, { action: 'navigate', target: first, transition: 'instant', duration: 0 });
  const reset = graph.createNode('TEXT', first, { name: 'Reset Details', text: 'Reset details', width: 100, height: 24 });
  setNavigation(editor, reset, { action: 'navigate', target: second, transition: 'instant', duration: 0, resetInteractiveComponents: true });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => hotspot('Next screen').click());
  const detailsCheckbox = host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')!;
  act(() => detailsCheckbox.click()); await act(async () => hotspot('Return home').click());
  const original = reactExport.selectionToDesignModel; let fail = true;
  vi.spyOn(reactExport, 'selectionToDesignModel').mockImplementation((source, ids, ...args) => {
    if (fail && ids[0] === second) { fail = false; throw new Error('Reset preparation failed'); }
    return original(source, ids, ...args);
  });
  await act(async () => hotspot('Reset Details').click());
  expect(host.querySelector('h2')?.textContent).toBe('Home');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Reset preparation failed');
  await act(async () => hotspot('Next screen').click());
  expect(host.querySelector('h2')?.textContent).toBe('Details');
  expect(host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Return home').click());
  await act(async () => hotspot('Reset Details').click());
  expect(host.querySelector('h2')?.textContent).toBe('Details');
  expect(host.querySelector<HTMLButtonElement>('.xd-prototype-screen [role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
});
it('isolates repeated overlay instances and resets a discarded occurrence on reopen', async () => {
  const { modal } = overlayScreens(true);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const baseCheckbox = host.querySelector<HTMLElement>('.xd-prototype-screen [role=checkbox]')!;
  act(() => baseCheckbox.click());
  const opener = hotspot('Next screen'); opener.focus(); await act(async () => opener.click());
  const firstOverlay = host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[0]!;
  const firstCheckbox = firstOverlay.querySelector<HTMLElement>('[role=checkbox]')!;
  expect(firstCheckbox.getAttribute('aria-checked')).toBe('false');
  const firstId = firstCheckbox.getAttribute('data-xdesign-layer');
  act(() => firstCheckbox.click()); expect(firstCheckbox.getAttribute('aria-checked')).toBe('true');
  const sameScreenOpener = hotspot('Open same overlay'); sameScreenOpener.focus(); await act(async () => sameScreenOpener.click());
  const frames = host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame'); expect(frames).toHaveLength(2);
  const topCheckbox = frames[1]!.querySelector<HTMLElement>('[role=checkbox]')!;
  expect(topCheckbox.getAttribute('aria-checked')).toBe('false');
  expect(topCheckbox.getAttribute('data-xdesign-layer')).not.toBe(firstId);
  act(() => topCheckbox.click()); expect(topCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Close overlay').click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(1);
  expect(document.activeElement).toBe(sameScreenOpener);
  expect(firstCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Close overlay').click());
  expect(baseCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => opener.click());
  expect(host.querySelector('.xd-prototype-overlay-frame [role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
  expect(host.querySelector('h2')?.textContent).toBe('Modal');
  expect(editor.graph.getNode(modal.id)).toBeDefined();
});
it('resets only the newly entered repeated-overlay occurrence', async () => {
  overlayScreens(true);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  const firstFrame = host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[0]!, firstCheckbox = firstFrame.querySelector<HTMLButtonElement>('[role=checkbox]')!;
  act(() => firstCheckbox.click()); expect(firstCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Reset same overlay').click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(2);
  expect(host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[1]!.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
  await act(async () => button('Close overlay').click());
  expect(firstFrame.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
});
it('keeps existing overlay control state after a failed swap and a subsequent control update', async () => {
  const { modal } = overlayScreens(true), graph = editor.graph, page = editor.state.currentPageId;
  const checkboxComponent = [...graph.nodes.values()].find(node => node.type === 'COMPONENT' && node.name === 'Check')!;
  graph.createInstance(checkboxComponent.id, modal.id, { x: 80, y: 40 });
  const invalid = graph.createNode('FRAME', page, { name: 'Invalid destination', width: 0, height: 80 });
  const swap = graph.createNode('TEXT', modal.id, { name: 'Swap invalid', text: 'Swap invalid', width: 80, height: 20 });
  setNavigation(editor, swap, { action: 'swap', target: invalid.id, transition: 'instant', duration: 0 });
  const before = serializeGraph(graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => hotspot('Next screen').click());
  const controls = () => host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame [role=checkbox]');
  expect(controls()).toHaveLength(2);
  await act(async () => controls()[0]!.click()); expect(controls()[0]!.getAttribute('aria-checked')).toBe('true');
  await act(async () => hotspot('Swap invalid').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('positive');
  expect(host.querySelector('h2')?.textContent).toBe('Modal');
  expect(controls()[0]!.getAttribute('aria-checked')).toBe('true');
  await act(async () => controls()[1]!.click());
  expect(controls()[0]!.getAttribute('aria-checked')).toBe('true');
  expect(controls()[1]!.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector('h2')?.textContent).toBe('Modal');
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false');
  await act(async () => hotspot('Go to Details').click());
  expect(host.querySelector('h2')?.textContent).toBe('Details');
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false');
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(serializeGraph(graph)).toBe(before);
});
it('closes only the top dialog on outside click and Navigate closes the remaining stack', async () => {
  const { nested } = overlayScreens(); setPrototypeOverlay(editor, nested, { position: 'center', closeOutside: true });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); await act(async () => hotspot('Open nested').click());
  await act(async () => (host.querySelectorAll('.xd-prototype-overlay')[0] as HTMLElement).click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(2);
  await act(async () => (host.querySelectorAll('.xd-prototype-overlay')[1] as HTMLElement).click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1);
  await act(async () => hotspot('Go to Details').click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => button('Back').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0);
});
it('recovers a failed overlay open without losing the active screen', async () => {
  const { modal } = overlayScreens(); editor.graph.updateNode(modal.id, { width: 0 });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('positive'); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect((host.querySelector('[role=checkbox]') as HTMLButtonElement).disabled).toBe(false); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0);
  act(() => (host.querySelector('[role=checkbox]') as HTMLButtonElement).click()); expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
});

it('places a manually positioned nested overlay relative to its trigger on the parent overlay', async () => {
  const { nested } = overlayScreens(); setPrototypeOverlay(editor, nested, { position: 'manual', closeOutside: false });
  const trigger = editor.graph.getChildren(editor.graph.getChildren(editor.state.currentPageId).find(node => node.name === 'Modal')!.id).find(node => node.name === 'Open nested')!;
  setNavigation(editor, trigger, { action: 'overlay', target: nested.id, offset: { x: -5, y: 10 }, transition: 'instant', duration: 0 });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  const view = host.querySelector<HTMLElement>('.xd-prototype-overlay [data-xdesign-view]')!, opener = hotspot('Open nested');
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue({ left: 160, top: 360, width: 160 } as DOMRect); vi.spyOn(opener, 'getBoundingClientRect').mockReturnValue({ left: 170, top: 380 } as DOMRect);
  await act(async () => opener.click()); const frame = host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[1]!; expect(frame.style.left).toBe('165px'); expect(frame.style.top).toBe('390px');
});
it('traps keyboard focus inside the active overlay and resets its state on Restart', async () => {
  overlayScreens(); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  const frame = host.querySelector('.xd-prototype-overlay-frame')!, view = frame.querySelector<HTMLElement>('[data-xdesign-view]')!, last = hotspot('Go to Details');
  last.focus(); act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); expect(document.activeElement).toBe(view);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))); expect(document.activeElement).toBe(last);
  await act(async () => button('Restart').click()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Back').disabled).toBe(true);
});
it('suspends underlay timers while an overlay is open and resumes them with a fresh delay', async () => {
  vi.useFakeTimers();
  try {
    overlayScreens(); setPrototypeInteractions(editor, editor.graph.getNode(first)!, [{ id: 'timer', trigger: { type: 'delay', delay: 100 }, navigation: { action: 'navigate', target: second, transition: 'instant', duration: 0 } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => vi.advanceTimersByTime(50)); await act(async () => hotspot('Next screen').click()); await act(async () => vi.advanceTimersByTime(1000)); expect(host.querySelector('h2')?.textContent).toBe('Modal');
    await act(async () => button('Close overlay').click()); await act(async () => vi.advanceTimersByTime(99)); expect(host.querySelector('h2')?.textContent).toBe('Home'); await act(async () => vi.advanceTimersByTime(1)); expect(host.querySelector('h2')?.textContent).toBe('Details');
    act(() => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); usePencilWorkspace.setState({ editor: null }); clearXDesignActivities(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)!;
it('plays a whole screen, retains control values across navigation and leaves the source untouched', async () => {
  const before = serializeGraph(editor.graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  expect(xdesignProjectChangeReason()).toContain('presentation');
  const checkbox = host.querySelector('[role=checkbox]') as HTMLButtonElement; act(() => checkbox.click()); expect(checkbox.getAttribute('aria-checked')).toBe('true');
  const next = host.querySelector('[role=link]') as HTMLElement;
  await act(async () => next.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(document.activeElement).toBe(host.querySelector('h2'));
  expect(host.querySelector('[data-transition=dissolve]')).not.toBeNull();
  await act(async () => button('Back').click()); expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Restart').click()); expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
  expect(serializeGraph(editor.graph)).toBe(before);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).toHaveBeenCalled();
  act(() => editor.graph.updateNode(first, { name: 'Changed' })); expect(close).toHaveBeenCalledTimes(2);
});
it('reports a removed destination and keeps the current screen operable', async () => {
  editor.graph.deleteNode(second);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => (host.querySelector('[role=link]') as HTMLElement).click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('removed'); expect(host.querySelector('h2')?.textContent).toBe('Home');
});
it('plays imported FIG clicks and visibly identifies preserved unsupported interactions', async () => {
  const graph = editor.graph, next = graph.getNode(first)!.childIds.map(id => graph.getNode(id)!).find(node => node.name === 'Next screen')!;
  next.pluginData = []; graph.getNode(second)!.source.id = '51:3';
  next.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 51, localID: 3 } }] }] };
  const unsupported = graph.createNode('RECTANGLE', first, { name: 'Voice hotspot' });
  unsupported.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_VOICE' }, actions: [{ connectionType: 'BACK' }] }] };
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  expect(host.querySelector('details')?.textContent).toContain('Voice hotspot');
  await act(async () => (host.querySelector('[role=link]') as HTMLElement).click()); expect(host.querySelector('h2')?.textContent).toBe('Details');
});

it('plays timed and keyboard navigation, pauses timers and resets their lifecycle on restart', async () => {
  vi.useFakeTimers();
  try {
    setPrototypeInteractions(editor, editor.graph.getNode(first)!, [{ id: 'delay', trigger: { type: 'delay', delay: 100 }, navigation: { action: 'navigate', target: second, transition: 'instant', duration: 0 } }]);
    setPrototypeInteractions(editor, editor.graph.getNode(second)!, [{ id: 'key', trigger: { type: 'key', keyCodes: [65] }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />));
    await act(async () => button('Pause timers').click()); await act(async () => vi.advanceTimersByTime(200)); expect(host.querySelector('h2')?.textContent).toBe('Home');
    await act(async () => button('Resume timers').click()); await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector('h2')?.textContent).toBe('Details');
    await act(async () => host.querySelector('[data-xdesign-view]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }))); expect(host.querySelector('h2')?.textContent).toBe('Home');
    await act(async () => vi.advanceTimersByTime(50)); await act(async () => button('Restart').click()); await act(async () => vi.advanceTimersByTime(99)); expect(host.querySelector('h2')?.textContent).toBe('Home'); await act(async () => vi.advanceTimersByTime(1)); expect(host.querySelector('h2')?.textContent).toBe('Details');
    act(() => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('ignores a second activation before loading settles', async () => {
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const next = host.querySelector('[role=link]') as HTMLElement;
  await act(async () => { next.click(); next.click(); }); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => button('Back').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Back').disabled).toBe(true);
});
it('pauses zero-delay cyclic flows instead of locking up presentation', async () => {
  vi.useFakeTimers();
  try {
    for (const [id, target] of [[first, second], [second, first]]) setPrototypeInteractions(editor, editor.graph.getNode(id!)!, [{ id: 'delay', trigger: { type: 'delay', delay: 0 }, navigation: { action: 'navigate', target, transition: 'instant', duration: 0 } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />));
    for (let index = 0; index < 22; index++) await act(async () => vi.advanceTimersByTime(16));
    expect(host.querySelector('footer')?.textContent).toContain('loops too quickly'); expect(button('Resume timers')).toBeDefined(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('allows the screen picker to recover from a destination that cannot be prepared', async () => {
  editor.graph.updateNode(second, { width: 0, height: 0 });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => (host.querySelector('[role=link]') as HTMLElement).click()); expect(host.querySelector('[role=alert]')?.textContent).toContain('positive');
  const picker = host.querySelector<HTMLSelectElement>('[aria-label="Presented screen"]')!;
  await act(async () => { picker.value = first; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector('[role=alert]')).toBeNull(); expect(host.querySelector('[role=checkbox]')?.hasAttribute('disabled')).toBe(false);
});

it('remembers screen and overlay scrolling, and Restart restores starting positions without editing the source', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'); const { modal } = overlayScreens(); setPrototypeScroll(editor, editor.graph.getNode(first)!, { axis: 'vertical', initial: { x: 0, y: 10 } }); setPrototypeScroll(editor, modal, { axis: 'vertical', initial: { x: 0, y: 20 } }); const before = serializeGraph(editor.graph);
  const scroll = (id: string) => host.querySelector<HTMLElement>(`[data-xdesign-scroll="${id}"]`)!;
  const overlayScroll = () => host.querySelector<HTMLElement>('.xd-prototype-overlay-frame [data-xdesign-scroll]')!;
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); scroll(first).scrollTop = 80; act(() => scroll(first).dispatchEvent(new Event('scroll'))); await act(async () => hotspot('Next screen').click()); overlayScroll().scrollTop = 60; act(() => overlayScroll().dispatchEvent(new Event('scroll')));
  await act(async () => button('Close overlay').click()); expect(scroll(first).scrollTop).toBe(80); await act(async () => hotspot('Next screen').click()); expect(overlayScroll().scrollTop).toBe(60);
  await act(async () => hotspot('Go to Details').click()); await act(async () => button('Back').click()); expect(scroll(first).scrollTop).toBe(80); await act(async () => button('Restart').click()); expect(scroll(first).scrollTop).toBe(10); expect(serializeGraph(editor.graph)).toBe(before);
});
it('rolls temporary different-overlay scrolling back without changing saved overlay history', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'), { modal, nested } = overlayScreens();
  setPrototypeScroll(editor, modal, { axis: 'vertical', initial: { x: 0, y: 20 } }); setPrototypeScroll(editor, nested, { axis: 'vertical', initial: { x: 0, y: 10 } });
  const nestedOpener = editor.graph.getChildren(modal.id).find(node => node.name === 'Open nested')!;
  const openNested: DesignNavigation = { action: 'overlay', target: nested.id, transition: 'instant', duration: 0 };
  setPrototypeInteractions(editor, nestedOpener, [{ id: 'temporary-nested', trigger: { type: 'press' }, navigation: openNested }, { id: 'open-nested', trigger: { type: 'click' }, navigation: openNested }]);
  const scroll = () => [...host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame [data-xdesign-scroll]')].at(-1)!;
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  scroll().scrollTop = 60; act(() => scroll().dispatchEvent(new Event('scroll'))); await act(async () => button('Close overlay').click());
  await act(async () => hotspot('Next screen').click()); expect(scroll().scrollTop).toBe(60);
  const opener = hotspot('Open nested'); opener.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  await act(async () => heldPointer(opener, 'pointerdown', 7)); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(2);
  scroll().scrollTop = 90; act(() => scroll().dispatchEvent(new Event('scroll'))); await act(async () => heldPointer(document, 'pointerup', 7));
  expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1); expect(scroll().scrollTop).toBe(60);
  await act(async () => button('Close overlay').click()); await act(async () => hotspot('Next screen').click()); expect(scroll().scrollTop).toBe(60);
  await act(async () => hotspot('Open nested').click()); expect(scroll().scrollTop).toBe(10);
});
it('clears saved overlay scroll history when resetScroll is explicitly requested', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'), { modal } = overlayScreens(); setPrototypeScroll(editor, modal, { axis: 'vertical', initial: { x: 0, y: 20 } });
  const reset = editor.graph.createNode('TEXT', modal.id, { name: 'Reset modal', text: 'Reset modal', width: 60, height: 20 });
  setNavigation(editor, reset, { action: 'swap', target: modal.id, transition: 'instant', duration: 0, resetScroll: true });
  const scroll = () => host.querySelector<HTMLElement>('.xd-prototype-overlay-frame [data-xdesign-scroll]')!;
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click());
  scroll().scrollTop = 60; act(() => scroll().dispatchEvent(new Event('scroll'))); await act(async () => hotspot('Reset modal').click()); expect(scroll().scrollTop).toBe(20);
  await act(async () => button('Close overlay').click()); await act(async () => hotspot('Next screen').click()); expect(scroll().scrollTop).toBe(20);
});
it('applies reset and layout-matched preservation only after a destination prepares successfully', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'); const graph = editor.graph, owner = graph.getNode(first)!, other = graph.getNode(second)!;
  setPrototypeScroll(editor, owner, { axis: 'vertical', initial: { x: 0, y: 10 } }); setPrototypeScroll(editor, other, { axis: 'vertical', initial: { x: 0, y: 30 } });
  const next = graph.getChildren(first).find(node => node.name === 'Next screen')!, main = graph.getChildren(editor.state.currentPageId).find(node => node.name === 'Check')!;
  graph.createNode('TEXT', second, { name: 'Next screen', text: 'Continue', width: 100, height: 30 }); graph.createInstance(main.id, second, { x: 20, y: 100 }); setNavigation(editor, next, { action: 'navigate', target: second, transition: 'instant', duration: 0, preserveScroll: true });
  const scroll = (id: string) => host.querySelector<HTMLElement>(`[data-xdesign-scroll="${id}"]`)!;
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); scroll(first).scrollTop = 120; act(() => scroll(first).dispatchEvent(new Event('scroll'))); await act(async () => hotspot('Next screen').click()); expect(scroll(second).scrollTop).toBe(120);
  await act(async () => button('Back').click()); expect(scroll(first).scrollTop).toBe(120); act(() => root.render(null)); setNavigation(editor, next, { action: 'navigate', target: second, transition: 'instant', duration: 0, resetScroll: true }); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(scroll(second).scrollTop).toBe(30);
});
it('plays local Scroll To inside presentation without changing its route or source graph', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'); const graph = editor.graph, owner = graph.getNode(first)!, target = graph.createNode('TEXT', first, { name: 'Footer', text: 'Footer', y: 900, width: 100, height: 20 }); setPrototypeScroll(editor, owner, { axis: 'vertical' }); const next = graph.getChildren(first).find(node => node.name === 'Next screen')!; setNavigation(editor, next, { action: 'scroll', target: target.id, transition: 'instant', duration: 0 }); const before = serializeGraph(graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const scroll = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!, footer = hotspot('Footer'); Object.defineProperties(scroll, { clientHeight: { value: 480 }, scrollHeight: { value: 1000 } }); Object.assign(footer, { scrollIntoView: () => { scroll.scrollTop = 500; } }); await act(async () => hotspot('Next screen').click()); expect(scroll.scrollTop).toBe(500); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Back').disabled).toBe(true); expect(host.querySelector('[role=alert]')).toBeNull(); expect(serializeGraph(graph)).toBe(before);
});

it('keeps current scrolling usable when a reset-on-arrival destination fails preparation', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'); const owner = editor.graph.getNode(first)!, next = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!; setPrototypeScroll(editor, owner, { axis: 'vertical' }); setNavigation(editor, next, { action: 'navigate', target: second, transition: 'instant', duration: 0, resetScroll: true }); editor.graph.updateNode(second, { width: 0 }); const before = serializeGraph(editor.graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const scroll = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!; scroll.scrollTop = 120; act(() => scroll.dispatchEvent(new Event('scroll'))); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('[role=alert]')?.textContent).toContain('positive'); expect(scroll.scrollTop).toBe(120); expect(scroll.hasAttribute('inert')).toBe(false); expect(serializeGraph(editor.graph)).toBe(before);
});
function sequenceSteps(...actions: DesignNavigation[]) {
  const node = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!;
  setNavigation(editor, node, { action: 'sequence', transition: 'instant', duration: 0, actions });
}
function sequenceMotion() {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate'), motions: { frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: (frames: Keyframe[], options: KeyframeAnimationOptions) => { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), cancel = vi.fn(); motions.push({ frames, options, finish, cancel }); return { finished, cancel }; } });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return { motions, restore: () => descriptor ? Object.defineProperty(HTMLElement.prototype, 'animate', descriptor) : Reflect.deleteProperty(HTMLElement.prototype, 'animate') };
}
it('continues a sequence across mounted screens, awaits each animation and retains navigation history', async () => {
  const { modal } = overlayScreens(), animation = sequenceMotion();
  sequenceSteps({ action: 'navigate', target: second, transition: 'slide', direction: 'left', duration: 200 }, { action: 'overlay', target: modal.id, transition: 'dissolve', duration: 200 }); const before = serializeGraph(editor.graph);
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(animation.motions).toHaveLength(2); expect(button('Stop actions')).toBeDefined();
    await act(async () => animation.motions[0]!.finish()); expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => animation.motions[1]!.finish()); expect(host.querySelector('h2')?.textContent).toBe('Modal'); expect(animation.motions).toHaveLength(3); expect(button('Stop actions')).toBeDefined();
    await act(async () => animation.motions[2]!.finish()); expect(button('Stop actions')).toBeUndefined(); await act(async () => button('Back').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { animation.restore(); }
});
it('executes Open, Swap, Close and Back in order across underlays without changing the source', async () => {
  const { modal, replacement } = overlayScreens(); sequenceSteps({ action: 'navigate', target: second, transition: 'instant', duration: 0 }, { action: 'overlay', target: modal.id, transition: 'instant', duration: 0 }, { action: 'swap', target: replacement.id, transition: 'instant', duration: 0 }, { action: 'close', transition: 'instant', duration: 0 }, { action: 'back', transition: 'instant', duration: 0 }); const before = serializeGraph(editor.graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(button('Back').disabled).toBe(true); expect(button('Stop actions')).toBeUndefined(); expect(serializeGraph(editor.graph)).toBe(before);
});
it('waits for the closing overlay and its background before the next screen action', async () => {
  const { modal } = overlayScreens(), animation = sequenceMotion(); sequenceSteps({ action: 'overlay', target: modal.id, transition: 'instant', duration: 0 }, { action: 'close', transition: 'slide', duration: 200 }, { action: 'navigate', target: second, transition: 'instant', duration: 0 });
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(animation.motions).toHaveLength(2); expect(host.querySelector('.xd-prototype-exiting')).not.toBeNull();
    await act(async () => animation.motions[0]!.finish()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector('.xd-prototype-exiting')).not.toBeNull();
    await act(async () => animation.motions[1]!.finish()); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(host.querySelector('.xd-prototype-exiting')).toBeNull(); expect(button('Stop actions')).toBeUndefined();
  } finally { animation.restore(); }
});
it('scrolls the newly prepared screen by source identity before continuing with an overlay', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'), { modal } = overlayScreens(), target = editor.graph.createNode('RECTANGLE', second, { name: 'Details footer', y: 900 }), animation = sequenceMotion(); setPrototypeScroll(editor, editor.graph.getNode(second)!, { axis: 'vertical' });
  sequenceSteps({ action: 'navigate', target: second, transition: 'slide', duration: 200 }, { action: 'scroll', target: target.id, transition: 'instant', duration: 0 }, { action: 'overlay', target: modal.id, transition: 'instant', duration: 0 });
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); const scroll = host.querySelector<HTMLElement>(`[data-xdesign-scroll="${second}"]`)!; Object.defineProperties(scroll, { clientHeight: { value: 480 }, scrollHeight: { value: 1200 } }); Object.assign(hotspot('Details footer'), { scrollIntoView: () => { scroll.scrollTop = 600; } });
    await act(async () => { animation.motions[0]!.finish(); animation.motions[1]!.finish(); }); expect(scroll.scrollTop).toBe(600); expect(host.querySelector('h2')?.textContent).toBe('Modal'); expect(host.querySelector('[role=alert]')).toBeNull();
  } finally { animation.restore(); }
});
it.each(['stop', 'wheel', 'pointer', 'hidden', 'restart', 'unmount'] as const)('stops remaining cross-screen steps on %s', async mode => {
  const { modal } = overlayScreens(), animation = sequenceMotion(); sequenceSteps({ action: 'navigate', target: second, transition: 'slide', duration: 200 }, { action: 'overlay', target: modal.id, transition: 'instant', duration: 0 });
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); const view = host.querySelector('[data-xdesign-view]')!;
    if (mode === 'stop') await act(async () => button('Stop actions').click());
    if (mode === 'wheel') act(() => view.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    if (mode === 'pointer') { act(() => view.dispatchEvent(new Event('pointerdown', { bubbles: true }))); expect(animation.motions[0]!.cancel).not.toHaveBeenCalled(); act(() => document.dispatchEvent(new Event('pointerup', { bubbles: true }))); }
    if (mode === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); }
    if (mode === 'restart') await act(async () => button('Restart').click());
    if (mode === 'unmount') act(() => root.render(null));
    await act(async () => animation.motions.forEach(motion => motion.finish())); expect(animation.motions[0]!.cancel).toHaveBeenCalled(); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); if (mode !== 'unmount') expect(host.querySelector('h2')?.textContent).toBe(mode === 'restart' ? 'Home' : 'Details');
  } finally { animation.restore(); }
});
it('stops a sequence on preparation failure and keeps the previous screen and controls usable', async () => {
  const { modal } = overlayScreens(); editor.graph.updateNode(modal.id, { width: 0 }); sequenceSteps({ action: 'overlay', target: modal.id, transition: 'instant', duration: 0 }, { action: 'navigate', target: second, transition: 'instant', duration: 0 });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector('[role=alert]')?.textContent).toContain('positive'); expect(button('Stop actions')).toBeUndefined(); const checkbox = host.querySelector<HTMLButtonElement>('[role=checkbox]')!; act(() => checkbox.click()); expect(checkbox.getAttribute('aria-checked')).toBe('true');
});
it('allows a delayed sequence with more than twenty distinct screen actions without treating its steps as a loop', async () => {
  vi.useFakeTimers();
  try {
    const actions: DesignNavigation[] = Array.from({ length: 24 }, (_, index) => ({ action: 'navigate', target: editor.graph.createNode('FRAME', editor.state.currentPageId, { name: `Step ${index + 1}`, width: 320, height: 480 }).id, transition: 'instant', duration: 0 }));
    const node = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!; setPrototypeInteractions(editor, node, [{ id: 'delay', trigger: { type: 'delay', delay: 0 }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => vi.advanceTimersByTime(16)); expect(host.querySelector('h2')?.textContent).toBe('Step 24'); expect(button('Pause timers')).toBeDefined(); expect(button('Stop actions')).toBeUndefined();
  } finally { vi.useRealTimers(); }
});
it('still pauses repeated delayed sequence activations that return to their source screen too quickly', async () => {
  vi.useFakeTimers();
  try {
    const node = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!; setPrototypeInteractions(editor, node, [{ id: 'delay', trigger: { type: 'delay', delay: 0 }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'navigate', target: second, transition: 'instant', duration: 0 }, { action: 'navigate', target: first, transition: 'instant', duration: 0 }] } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); for (let tick = 0; tick < 20; tick++) await act(async () => vi.advanceTimersByTime(16)); expect(button('Pause timers')).toBeDefined(); for (let tick = 0; tick < 4; tick++) await act(async () => vi.advanceTimersByTime(16));
    expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Resume timers')).toBeDefined(); expect(host.querySelector('footer')?.textContent).toContain('loops too quickly'); expect(button('Stop actions')).toBeUndefined();
    await act(async () => button('Resume timers').click()); await act(async () => vi.advanceTimersByTime(16)); expect(button('Pause timers')).toBeDefined(); expect(host.querySelector('footer')?.textContent).not.toContain('loops too quickly');
  } finally { vi.useRealTimers(); }
});
it('does not replay a spent delayed scroll sequence when the queue completes on the same screen', async () => {
  vi.useFakeTimers();
  try {
    const { setPrototypeScroll } = await import('./prototypeScroll'), one = editor.graph.createNode('RECTANGLE', first, { name: 'First scroll destination', y: 900 }), two = editor.graph.createNode('RECTANGLE', first, { name: 'Second scroll destination', y: 1000 }), node = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!;
    setPrototypeScroll(editor, editor.graph.getNode(first)!, { axis: 'vertical' }); setPrototypeInteractions(editor, node, [{ id: 'delay', trigger: { type: 'delay', delay: 0 }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'scroll', target: one.id, transition: 'instant', duration: 0 }, { action: 'scroll', target: two.id, transition: 'instant', duration: 0 }] } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const scroll = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!; Object.defineProperties(scroll, { clientHeight: { value: 480 }, scrollHeight: { value: 1400 } }); const alignOne = vi.fn(() => { scroll.scrollTop = 600; }), alignTwo = vi.fn(() => { scroll.scrollTop = 700; }); Object.assign(hotspot('First scroll destination'), { scrollIntoView: alignOne }); Object.assign(hotspot('Second scroll destination'), { scrollIntoView: alignTwo });
    await act(async () => vi.advanceTimersByTime(16)); expect(alignOne).toHaveBeenCalledOnce(); expect(alignTwo).toHaveBeenCalledOnce(); await act(async () => vi.advanceTimersByTime(1000)); expect(alignOne).toHaveBeenCalledOnce(); expect(alignTwo).toHaveBeenCalledOnce(); expect(button('Pause timers')).toBeDefined();
  } finally { vi.useRealTimers(); }
});

it('materializes assignments, inherited modes and branches in-place before the next step, retains them across navigation and resets on Restart', async () => {
  const graph = editor.graph, home = graph.getNode(first)!, collection = graph.createCollection('Flow'), dark = crypto.randomUUID(); graph.addMode(collection.id, dark, 'Dark');
  const count = graph.createVariable('Counter', 'FLOAT', collection.id, 0), shown = graph.createVariable('Shown', 'BOOLEAN', collection.id, false), width = graph.createVariable('Size', 'FLOAT', collection.id, 20), ink = graph.createVariable('Ink', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); editor.updateVariableValue(width.id, dark, 60); editor.updateVariableValue(ink.id, dark, { r: 0, g: 0, b: 1, a: 1 });
  const mark = graph.createNode('RECTANGLE', first, { name: 'Variable mark', width: 20, height: 20, visible: false, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }); graph.bindVariable(mark.id, 'visible', shown.id); graph.bindVariable(mark.id, 'width', width.id); graph.bindVariable(mark.id, 'fills/0/color', ink.id);
  const explicit = graph.createNode('RECTANGLE', first, { name: 'Explicit light', width: 20, height: 20, variableModes: { [collection.id]: collection.defaultModeId } }); graph.bindVariable(explicit.id, 'width', width.id);
  const run = graph.getChildren(first).find(node => node.name === 'Next screen')!; const instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, run, [{ id: 'click', trigger: { type: 'click' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'set-variable', variable: count.id, value: { type: 'expression', operator: 'ADDITION', arguments: [{ type: 'variable', id: count.id }, { type: 'literal', value: 1 }] } }, { ...instant, action: 'conditional', branches: [{ condition: { type: 'expression', operator: 'EQUALS', arguments: [{ type: 'variable', id: count.id }, { type: 'literal', value: 1 }] }, actions: [{ ...instant, action: 'set-mode', collection: collection.id, mode: dark }, { ...instant, action: 'set-variable', variable: shown.id, value: { type: 'literal', value: true } }] }, { actions: [{ ...instant, action: 'navigate', target: second }] }] }] } }]);
  const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); expect(hotspot('Variable mark')).toBeUndefined(); const focused = hotspot('Next screen'); focused.focus();
  await act(async () => focused.click()); expect(hotspot('Variable mark').style.width).toBe('60px'); expect(hotspot('Explicit light').style.width).toBe('20px'); expect(hotspot('Variable mark').querySelector('img')!.src).toContain('%230000FF'); expect(document.activeElement).toBe(focused);
  await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => button('Back').click()); expect(hotspot('Variable mark').style.width).toBe('60px');
  await act(async () => button('Restart').click()); expect(hotspot('Variable mark')).toBeUndefined(); expect(hotspot('Explicit light').style.width).toBe('20px'); expect(serializeGraph(graph)).toBe(before); expect(home.variableModes).toEqual({});
});
it('lets click activation supersede a temporary hover sequence without restoring its values later', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const graph = editor.graph, collection = graph.createCollection('Hover lease'), dark = crypto.randomUUID(); graph.addMode(collection.id, dark, 'Dark');
  const width = graph.createVariable('Width', 'FLOAT', collection.id, 320), shown = graph.createVariable('Shown', 'BOOLEAN', collection.id, false), clicks = graph.createVariable('Clicks', 'FLOAT', collection.id, 0);
  editor.updateVariableValue(width.id, dark, 360);
  graph.bindVariable(first, 'width', width.id);
  const mark = graph.createNode('RECTANGLE', first, { name: 'Hover mark', width: 20, height: 20, visible: false }); graph.bindVariable(mark.id, 'visible', shown.id); graph.bindVariable(mark.id, 'width', width.id);
  const clickMark = graph.createNode('RECTANGLE', first, { name: 'Click mark', x: 40, width: 20, height: 20 }); graph.bindVariable(clickMark.id, 'width', clicks.id);
  const opener = graph.getChildren(first).find(node => node.name === 'Next screen')!, instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, opener, [
    { id: 'hover', trigger: { type: 'hover' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'set-mode', collection: collection.id, mode: dark }, { ...instant, action: 'set-variable', variable: shown.id, value: { type: 'literal', value: true } }] } },
    { id: 'click', trigger: { type: 'click' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'set-variable', variable: clicks.id, value: { type: 'expression', operator: 'ADDITION', arguments: [{ type: 'variable', id: clicks.id }, { type: 'literal', value: 1 }] } }, { ...instant, action: 'navigate', target: second }] } },
  ]);
  const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const originalLayer = hotspot('Next screen'); originalLayer.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect);
  await act(async () => heldPointer(originalLayer, 'pointerover', 7));
  await vi.waitFor(() => expect(host.querySelector<HTMLElement>('[data-name="Hover mark"]')).not.toBeNull());
  expect(host.querySelector<HTMLElement>('[data-name="Hover mark"]')?.style.width).toBe('360px');
  await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => { heldPointer(originalLayer, 'pointerout', 7, 500); heldPointer(document, 'pointermove', 7, 500); heldPointer(document, 'pointerup', 7); window.dispatchEvent(new Event('blur')); });
  expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => button('Back').click());
  expect(host.querySelector<HTMLElement>('[data-name="Hover mark"]')?.style.width).toBe('360px'); expect(host.querySelector('[data-name="Hover mark"]')).not.toBeNull(); expect(host.querySelector<HTMLElement>('[data-name="Click mark"]')?.style.width).toBe('1px');
  expect(serializeGraph(graph)).toBe(before);
});
it('ends a hover lease when the same source layer starts a local click action', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const graph = editor.graph, collection = graph.createCollection('Same source lease'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320), shown = graph.createVariable('Shown', 'BOOLEAN', collection.id, false);
  graph.bindVariable(first, 'width', width.id);
  const mark = graph.createNode('RECTANGLE', first, { name: 'Lease mark', width: 20, height: 20, visible: false }); graph.bindVariable(mark.id, 'visible', shown.id);
  const source = graph.getChildren(first).find(node => node.name === 'Next screen')!, instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, source, [
    { id: 'hover', trigger: { type: 'hover' }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 360 } } },
    { id: 'click', trigger: { type: 'click' }, navigation: { ...instant, action: 'set-variable', variable: shown.id, value: { type: 'literal', value: true } } },
  ]);
  const before = serializeGraph(graph);
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const sourceLayer = hotspot('Next screen');
  sourceLayer.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect);
  await act(async () => heldPointer(sourceLayer, 'pointerover', 13));
  await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('360px'));
  expect(host.querySelector('[data-name="Lease mark"]')).toBeNull();
  await act(async () => hotspot('Next screen').click());
  expect(host.querySelector('[data-name="Lease mark"]')).not.toBeNull();
  expect(host.querySelector<HTMLElement>('[data-name="Lease mark"]')?.style.display).not.toBe('none');
  await act(async () => { heldPointer(sourceLayer, 'pointerout', 13, 500); heldPointer(document, 'pointermove', 13, 500); heldPointer(document, 'pointerup', 13); window.dispatchEvent(new Event('blur')); });
  expect(host.querySelector('h2')?.textContent).toBe('Home');
  expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('360px');
  expect(host.querySelector<HTMLElement>('[data-name="Lease mark"]')?.style.display).not.toBe('none');
  expect(serializeGraph(graph)).toBe(before);
});
it('keeps a press lease distinct after returning to the same screen with different route history', async () => {
  const graph = editor.graph, collection = graph.createCollection('History lease'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320);
  graph.bindVariable(first, 'width', width.id);
  const source = graph.getChildren(first).find(node => node.name === 'Next screen')!, instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, source, [
    { id: 'held-return', trigger: { type: 'press' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'navigate', target: second }, { ...instant, action: 'navigate', target: first }] } },
    { id: 'destination-local', trigger: { type: 'click' }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 400 } } },
  ]);
  const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const original = hotspot('Next screen'); original.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect);
  await act(async () => heldPointer(original, 'pointerdown', 21));
  expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('320px'); expect(button('Back').disabled).toBe(false);
  await act(async () => hotspot('Next screen').click()); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('400px');
  await act(async () => heldPointer(document, 'pointerup', 21));
  expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('320px'); expect(button('Back').disabled).toBe(true); expect(serializeGraph(graph)).toBe(before);
});
it('keeps an automatic same-source delay inside an active hover lease until release', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true })); vi.useFakeTimers();
  const graph = editor.graph, collection = graph.createCollection('Automatic lease'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(first, 'width', width.id);
  const source = graph.getChildren(first).find(node => node.name === 'Next screen')!, instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, source, [
    { id: 'hover', trigger: { type: 'hover' }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 360 } } },
    { id: 'delay', trigger: { type: 'delay', delay: 100 }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 420 } } },
  ]);
  const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const layer = hotspot('Next screen');
  await act(async () => heldPointer(layer, 'pointerover', 19)); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('360px');
  await act(async () => { await vi.advanceTimersByTimeAsync(100); }); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('420px');
  await act(async () => heldPointer(document, 'pointermove', 19, 500)); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('320px');
  expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(serializeGraph(graph)).toBe(before);
});
it('keeps an inert underlay click blocked during a temporary hover overlay', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const opener = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!, { modal } = overlayScreens();
  setPrototypeInteractions(editor, opener, [
    { id: 'hover', trigger: { type: 'hover' }, navigation: { action: 'overlay', target: modal.id, transition: 'instant', duration: 0 } },
    { id: 'click', trigger: { type: 'click' }, navigation: { action: 'navigate', target: second, transition: 'instant', duration: 0 } },
  ]);
  const before = serializeGraph(editor.graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => heldPointer(hotspot('Next screen'), 'pointerover', 7)); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1);
  const underlay = [...host.querySelectorAll<HTMLElement>('[data-name="Next screen"]')].find(element => element.closest('.xd-prototype-screen'))!;
  expect(underlay.closest('.xd-prototype-content')?.hasAttribute('inert')).toBe(true);
  await act(async () => underlay.click()); expect(host.querySelector('h2')?.textContent).toBe('Modal'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1);
  await act(async () => heldPointer(document, 'pointermove', 7, 500)); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(serializeGraph(editor.graph)).toBe(before);
});
it('cancels a delayed hover before it creates a temporary lease and still permits click navigation', async () => {
  vi.useFakeTimers(); try {
    const graph = editor.graph, collection = graph.createCollection('Delayed hover'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(first, 'width', width.id);
    const opener = graph.getChildren(first).find(node => node.name === 'Next screen')!, instant = { transition: 'instant' as const, duration: 0 };
    setPrototypeInteractions(editor, opener, [
      { id: 'hover', trigger: { type: 'hover', delay: 100 }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 360 } } },
      { id: 'click', trigger: { type: 'click' }, navigation: { ...instant, action: 'navigate', target: second } },
    ]);
    const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const layer = hotspot('Next screen');
    await act(async () => heldPointer(layer, 'pointerover')); await act(async () => { vi.advanceTimersByTime(50); heldPointer(layer, 'pointerout'); }); await act(async () => vi.advanceTimersByTime(100));
    expect(host.querySelector<HTMLElement>('.xd-prototype-screen')?.style.width).toBe('320px'); expect(host.querySelector('h2')?.textContent).toBe('Home');
    await act(async () => hotspot('Next screen').click()); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(serializeGraph(graph)).toBe(before);
  } finally { vi.useRealTimers(); }
});
it('stops after an invalid bound value, recovers the previous usable screen and keeps the saved graph untouched', async () => {
  const graph = editor.graph, collection = graph.createCollection('Sizes'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(first, 'width', width.id); const run = graph.getChildren(first).find(node => node.name === 'Next screen')!;
  setPrototypeInteractions(editor, run, [{ id: 'bad', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: -1 }, transition: 'instant', duration: 0 }, { action: 'navigate', target: second, transition: 'instant', duration: 0 }] } }]);
  const before = serializeGraph(graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); expect(host.querySelector('[role=alert]')?.textContent).toContain('invalid width'); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect((host.querySelector('[role=checkbox]') as HTMLButtonElement).disabled).toBe(false); expect(serializeGraph(graph)).toBe(before);
});
it('does not re-arm a spent assignment timer when its bound artwork changes', async () => {
  vi.useFakeTimers(); try {
    const graph = editor.graph, collection = graph.createCollection('Timer'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(first, 'width', width.id);
    setPrototypeInteractions(editor, graph.getNode(first)!, [{ id: 'timer', trigger: { type: 'delay', delay: 100 }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'expression', operator: 'ADDITION', arguments: [{ type: 'variable', id: width.id }, { type: 'literal', value: 10 }] }, transition: 'instant', duration: 0 } }]);
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('330px'); await act(async () => vi.advanceTimersByTime(1000)); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('330px');
  } finally { vi.useRealTimers(); }
});

function heldPointer(target: EventTarget, type: string, pointerId = 1, x = 50) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 50, button: 0 }); Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'mouse' } }); target.dispatchEvent(event);
}
function heldSetup(type: 'hover' | 'press', overlay = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const next = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!;
  setPrototypeInteractions(editor, next, [{ id: 'held', trigger: { type }, navigation: { action: overlay ? 'overlay' : 'navigate', target: second, transition: 'instant', duration: 0 } }]);
  return next;
}
it.each([
  { transition: 'move-in', expected: 'translateX(320px)', edge: 'last' },
  { transition: 'move-out', expected: 'translateX(320px)', edge: 'first' },
  { transition: 'slide', expected: 'translateX(-80px)', edge: 'first' },
  { transition: 'slide-out', expected: 'translateX(320px)', edge: 'first' },
  { transition: 'push', expected: 'translateX(-320px)', edge: 'first' },
] as const)('returns a held $transition through its inverse spatial transition including the default direction', async ({ transition, expected, edge }) => {
  const node = heldSetup('press'); setPrototypeInteractions(editor, node, [{ id: 'held', trigger: { type: 'press' }, navigation: { action: 'navigate', target: second, transition, duration: 200 } }]); const animation = sequenceMotion(), before = serializeGraph(editor.graph);
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => heldPointer(hotspot('Next screen'), 'pointerdown', 7)); const count = animation.motions.length; expect(count).toBe(transition === 'move-in' || transition === 'move-out' ? 1 : 2);
    await act(async () => animation.motions.forEach(motion => motion.finish())); await act(async () => heldPointer(document, 'pointerup', 7)); expect(host.querySelector('h2')?.textContent).toBe('Home');
    const frames = animation.motions[count]!.frames; expect((edge === 'first' ? frames[0] : frames.at(-1))?.transform).toBe(expected); expect(serializeGraph(editor.graph)).toBe(before); expect(button('Back').disabled).toBe(true);
  } finally { animation.restore(); }
});
it.each(['hover', 'press'] as const)('restores the original screen, history, focus and controls after %s navigation', async type => {
  heldSetup(type); const before = serializeGraph(editor.graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  act(() => (host.querySelector('[role=checkbox]') as HTMLButtonElement).click()); const opener = hotspot('Next screen'); opener.tabIndex = 0; opener.focus();
  vi.spyOn(opener, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect);
  await act(async () => heldPointer(opener, type === 'hover' ? 'pointerover' : 'pointerdown', 7)); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(opener.isConnected).toBe(false);
  await act(async () => heldPointer(document, type === 'hover' ? 'pointermove' : 'pointerup', 8, 500)); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => heldPointer(document, type === 'hover' ? 'pointermove' : 'pointerup', 7, 500)); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Back').disabled).toBe(true); expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true'); expect(document.activeElement).toBe(hotspot('Next screen')); expect(serializeGraph(editor.graph)).toBe(before);
});
it('restores a temporary overlay on release even though its opener is inert', async () => {
  heldSetup('press', true); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const opener = hotspot('Next screen'); vi.spyOn(opener, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  await act(async () => heldPointer(opener, 'pointerdown')); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1); expect(host.querySelector('.xd-prototype-content')?.hasAttribute('inert')).toBe(true);
  await act(async () => heldPointer(document, 'pointerup')); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector('.xd-prototype-content')?.hasAttribute('inert')).toBe(false);
});
it('handles release before screen preparation and discards restoration after Restart', async () => {
  heldSetup('press'); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  await act(async () => { heldPointer(hotspot('Next screen'), 'pointerdown'); heldPointer(document, 'pointerup'); }); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.textContent).not.toContain('Preparing');
  await act(async () => heldPointer(hotspot('Next screen'), 'pointerdown')); expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => button('Restart').click());
  await act(async () => heldPointer(document, 'pointerup')); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(button('Back').disabled).toBe(true); expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
});
it('discards a temporary route when the user explicitly navigates from its destination', async () => {
  heldSetup('press'); const third = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Final', width: 320, height: 480 }); const onward = editor.graph.createNode('TEXT', second, { name: 'Onward', text: 'Onward' }); setNavigation(editor, onward, { action: 'navigate', target: third.id, transition: 'instant', duration: 0 });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => heldPointer(hotspot('Next screen'), 'pointerdown')); await act(async () => hotspot('Onward').click()); expect(host.querySelector('h2')?.textContent).toBe('Final');
  await act(async () => heldPointer(document, 'pointerup')); expect(host.querySelector('h2')?.textContent).toBe('Final'); await act(async () => button('Back').click()); expect(host.querySelector('h2')?.textContent).toBe('Details');
});

it('counts temporary checkpoint models in the aggregate budget and recovers the prior route when exceeded', async () => {
  heldSetup('press'); const graph = editor.graph, third = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Large target', width: 320, height: 480 }), onward = graph.createNode('TEXT', second, { name: 'Second hold', text: 'Second hold' }); setPrototypeInteractions(editor, onward, [{ id: 'press', trigger: { type: 'press' }, navigation: { action: 'navigate', target: third.id, transition: 'instant', duration: 0 } }]);
  const original = reactExport.selectionToDesignModel; vi.spyOn(reactExport, 'selectionToDesignModel').mockImplementation((source, ids, ...args) => ({ ...original(source, ids, ...args), byteLength: (ids[0] === third.id ? 15 : 10) * 1024 * 1024 }));
  await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => heldPointer(hotspot('Next screen'), 'pointerdown', 1)); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => heldPointer(hotspot('Second hold'), 'pointerdown', 2)); expect(host.querySelector('[role=alert]')?.textContent).toContain('Temporary interactions'); expect(host.querySelector('h2')?.textContent).toBe('Details');
  await act(async () => heldPointer(document, 'pointerup', 2)); expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => heldPointer(document, 'pointerup', 1)); expect(host.querySelector('h2')?.textContent).toBe('Home');
});

it('captures the current visual before canceling an interrupted Smart animation', async () => {
  const graph = editor.graph, opener = graph.getChildren(first).find(node => node.name === 'Next screen')!, third = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Final', width: 320, height: 480 });
  setNavigation(editor, opener, { action: 'navigate', target: second, transition: 'smart', duration: 300 });
  graph.createNode('RECTANGLE', first, { name: 'Card', x: 20, y: 40, width: 40, height: 30 }); graph.createNode('RECTANGLE', second, { name: 'Card', x: 100, y: 60, width: 80, height: 30 }); graph.createNode('RECTANGLE', third.id, { name: 'Card', x: 160, y: 80, width: 120, height: 30 });
  const next = graph.createNode('TEXT', second, { name: 'Finish', text: 'Finish', width: 100, height: 30 }); setNavigation(editor, next, { action: 'navigate', target: third.id, transition: 'smart', duration: 300 });
  const before = serializeGraph(graph), descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate'), jobs: { node: HTMLElement; frames: Keyframe[]; pause: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[]) { const node = this, pause = vi.fn(), cancel = vi.fn(() => { node.style.transform = 'none'; }); jobs.push({ node, frames, pause, cancel }); return { pause, cancel, play() {}, finished: new Promise<void>(() => {}) }; } });
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); const card = host.querySelector<HTMLElement>('[data-xdesign-layer][data-name=Card]')!, firstJobs = [...jobs]; card.closest('[data-xdesign-view]')!.parentElement!.style.transform = 'matrix(1,0,0,1,0,0)'; card.style.transform = 'matrix(0.75,0,0,1,-40,-10)'; vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ left: 60, top: 50, width: 60, height: 30 } as DOMRect);
    await act(async () => { hotspot('Finish').click(); const pending = host.querySelector('.xd-prototype-screen')!.lastElementChild!; const state = JSON.parse(pending.querySelector('[data-name=Card][data-xdesign-motion-state]')!.getAttribute('data-xdesign-motion-state')!); expect(state.pose.matrix).toEqual([0.75, 0, 0, 1, 60, 50]); }); const track = jobs.slice(firstJobs.length).find(job => job.node.getAttribute('data-name') === 'Card')!; expect(track.frames[0]!.transform).toContain('matrix(0.5,0,0,1,-100,-30)'); expect(firstJobs.every(job => job.cancel.mock.calls.length === 1)).toBe(true); expect(firstJobs.some(job => job.pause.mock.calls.length === 1)).toBe(true); expect(host.querySelector('h2')?.textContent).toBe('Final'); expect(serializeGraph(graph)).toBe(before);
  } finally { if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); }
});
it.each(['success', 'failure', 'restart'] as const)('retains the current visual during async preparation and restores visibility on %s', async mode => {
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  let ready!: (value: undefined) => void; vi.spyOn(pencilRuntime, 'initializeCanvasKit').mockReturnValue(new Promise<undefined>(resolve => { ready = resolve; }) as unknown as ReturnType<typeof pencilRuntime.initializeCanvasKit>);
  if (mode === 'failure') { const original = reactExport.selectionToDesignModel; vi.spyOn(reactExport, 'selectionToDesignModel').mockImplementation((...args) => { if (args[1][0] === second) throw new Error('Preparation failed'); return original(...args); }); }
  await act(async () => hotspot('Next screen').click()); const frame = host.querySelector<HTMLElement>('.xd-prototype-screen')!; expect(frame.style.visibility).toBe('hidden'); const retained = frame.querySelector<HTMLElement>('[data-xdesign-snapshot]')!; expect(retained.style.visibility).toBe('visible'); expect(retained.hasAttribute('inert')).toBe(true); expect(retained.textContent).toContain('Continue');
  if (mode === 'restart') await act(async () => button('Restart').click()); await act(async () => ready(undefined)); expect(frame.style.visibility).toBe(''); expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect(host.querySelector('h2')?.textContent).toBe(mode === 'success' ? 'Details' : 'Home'); if (mode === 'failure') expect(host.querySelector('[role=alert]')?.textContent).toContain('Preparation failed');
});
it('discards a stale reset destination before model creation or cache publication', async () => {
  const opener = editor.graph.getChildren(first).find(node => node.name === 'Next screen')!;
  setNavigation(editor, opener, { action: 'navigate', target: second, transition: 'instant', duration: 0, resetInteractiveComponents: true });
  await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  let ready!: (value: undefined) => void;
  vi.spyOn(pencilRuntime, 'initializeCanvasKit').mockReturnValue(new Promise<undefined>(resolve => { ready = resolve; }) as unknown as ReturnType<typeof pencilRuntime.initializeCanvasKit>);
  const original = reactExport.selectionToDesignModel, models = vi.spyOn(reactExport, 'selectionToDesignModel').mockImplementation((...args) => original(...args));
  await act(async () => hotspot('Next screen').click());
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => button('Restart').click());
  await act(async () => ready(undefined));
  expect(models.mock.calls.map(([, ids]) => ids[0])).toEqual([first]);
  expect(host.querySelector('h2')?.textContent).toBe('Home');
});
it.each(['success', 'failure', 'restart', 'unmount'] as const)('waits for native font preparation and discards stale models on %s', async mode => {
  const before = serializeGraph(editor.graph); await act(async () => root.render(<PrototypePreviewDialog close={close} />));
  const fakeKit = {} as NonNullable<Awaited<ReturnType<typeof pencilRuntime.initializeCanvasKit>>>; vi.spyOn(pencilRuntime, 'initializeCanvasKit').mockResolvedValue(fakeKit);
  let ready!: () => void, fail!: (error: Error) => void; const pending = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject; }); const fonts = vi.spyOn(reactExport, 'prepareDesignModelFonts').mockReturnValue(pending);
  const original = reactExport.selectionToDesignModel, models = vi.spyOn(reactExport, 'selectionToDesignModel').mockImplementation((source, ids, _kit, presentation, session, controls, host) => original(source, ids, undefined, presentation, session, controls, host));
  await act(async () => hotspot('Next screen').click()); expect(fonts).toHaveBeenCalledWith(editor.graph, [second], expect.objectContaining({ values: {} }), {}); expect(models).not.toHaveBeenCalled();
  const frame = host.querySelector<HTMLElement>('.xd-prototype-screen')!; expect(frame.style.visibility).toBe('hidden'); expect(frame.querySelector('[data-xdesign-snapshot]')?.textContent).toContain('Continue');
  if (mode === 'restart') await act(async () => button('Restart').click()); if (mode === 'unmount') act(() => root.render(null));
  await act(async () => { if (mode === 'failure') fail(new Error('Font preparation failed')); else ready(); });
  expect(models).toHaveBeenCalledTimes(mode === 'success' || mode === 'restart' ? 1 : 0); if (mode === 'success' || mode === 'restart') expect(models).toHaveBeenCalledWith(editor.graph, [mode === 'restart' ? first : second], fakeKit, true, expect.objectContaining({ values: {} }), {}, true);
  if (mode === 'unmount') expect(host.childElementCount).toBe(0); else { expect(frame.style.visibility).toBe(''); expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect(host.querySelector('h2')?.textContent).toBe(mode === 'success' ? 'Details' : 'Home'); if (mode === 'failure') expect(host.querySelector('[role=alert]')?.textContent).toContain('Font preparation failed'); }
  expect(serializeGraph(editor.graph)).toBe(before);
});
it('resumes paused motion after a pointer release that does not navigate', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate'), pause = vi.fn(), play = vi.fn(), cancel = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => ({ pause, play, cancel, currentTime: 50, finished: new Promise<void>(() => {}) }) });
  try { await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => hotspot('Next screen').click()); await act(async () => host.querySelector('[data-xdesign-view]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))); expect(pause).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled(); await act(async () => document.dispatchEvent(new Event('pointerup', { bubbles: true }))); expect(play).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled(); }
  finally { if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); }
});

function dragMotion() {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate'), jobs: { node: HTMLElement; currentTime: number; frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn>; effect: { setKeyframes: ReturnType<typeof vi.fn>; updateTiming: ReturnType<typeof vi.fn> } }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), job = { node: this, currentTime: 0, frames, options, finish: () => finish(), cancel: vi.fn(), pause: vi.fn(), play: vi.fn(), effect: { setKeyframes: vi.fn((next: Keyframe[]) => { job.frames = next; }), updateTiming: vi.fn((next: KeyframeEffectOptions) => { Object.assign(job.options, next); }) } }; jobs.push(job); return Object.assign(job, { finished }); } });
  return { jobs, restore: () => { if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); } };
}
function dragPointer(target: EventTarget, type: string, x: number, time: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 20 }); Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, timeStamp: { value: time } }); target.dispatchEvent(event);
}
function dragCards(navigation?: DesignNavigation) {
  const card = editor.graph.createNode('RECTANGLE', first, { name: 'Drag card', x: 20, width: 40, height: 40 }); editor.graph.createNode('RECTANGLE', second, { name: 'Drag card', x: 120, width: 40, height: 40 }); setPrototypeInteractions(editor, card, [{ id: 'drag', trigger: { type: 'drag' }, navigation: navigation ?? { action: 'navigate', target: second, transition: 'smart', duration: 300, easing: 'linear' } }]); return card;
}
it.each(['commit', 'rollback', 'cancel'] as const)('scrubs actual Present Smart geometry and restores/retains route, history and source on %s', async mode => {
  dragCards(); const before = serializeGraph(editor.graph), animation = dragMotion();
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); const card = host.querySelector<HTMLElement>('[data-xdesign-layer][data-name="Drag card"]')!; await act(async () => dragPointer(card, 'pointerdown', 40, 0)); await act(async () => dragPointer(document, 'pointermove', mode === 'commit' ? 120 : 80, 100)); expect(host.querySelector('h2')?.textContent).toBe('Details'); const job = animation.jobs.find(job => job.node.getAttribute('data-xdesign-layer') && job.node.getAttribute('data-name') === 'Drag card')!; expect(job.currentTime).toBe(mode === 'commit' ? 240 : 120); expect(job.effect.updateTiming).toHaveBeenCalledWith({ duration: 300, easing: 'linear' }); expect(host.querySelector('.xd-prototype-stage > .xd-prototype-screen > .xd-prototype-content')?.hasAttribute('inert')).toBe(true);
    const previous = animation.jobs.length; await act(async () => dragPointer(document, mode === 'cancel' ? 'pointercancel' : 'pointerup', mode === 'commit' ? 120 : 80, 200)); if (mode !== 'cancel') { expect(animation.jobs.slice(previous).some(job => job.options.duration === (mode === 'commit' ? 60 : 120))).toBe(true); await act(async () => animation.jobs.slice(previous).forEach(job => job.finish())); }
    expect(host.querySelector('h2')?.textContent).toBe(mode === 'commit' ? 'Details' : 'Home'); expect(button('Back').disabled).toBe(mode !== 'commit'); expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect(host.querySelector('.xd-prototype-stage > .xd-prototype-screen > .xd-prototype-content')?.hasAttribute('inert')).toBe(false); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { animation.restore(); }
});
it('queues release during async preparation and waits for the first motion before later sequence actions', async () => {
  const { modal } = overlayScreens(); dragCards({ action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'navigate', target: second, transition: 'smart', duration: 300, easing: 'linear' }, { action: 'overlay', target: modal.id, transition: 'instant', duration: 0 }] }); const animation = dragMotion();
  try {
    await act(async () => root.render(<PrototypePreviewDialog close={close} />)); let ready!: () => void; vi.spyOn(pencilRuntime, 'initializeCanvasKit').mockReturnValue(new Promise<undefined>(resolve => { ready = () => resolve(undefined); }) as unknown as ReturnType<typeof pencilRuntime.initializeCanvasKit>);
    await act(async () => dragPointer(host.querySelector<HTMLElement>('[data-name="Drag card"]')!, 'pointerdown', 40, 0)); await act(async () => dragPointer(document, 'pointermove', 120, 100)); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(host.querySelector('.xd-prototype-screen')?.getAttribute('style')).toContain('visibility: hidden'); await act(async () => dragPointer(document, 'pointerup', 120, 200)); const previous = animation.jobs.length; await act(async () => ready()); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(0); const active = animation.jobs.slice(previous).filter(job => !job.cancel.mock.calls.length); expect(active.some(job => job.options.duration === 60)).toBe(true); await act(async () => active.forEach(job => job.finish())); await act(async () => ready()); expect(host.querySelector('h2')?.textContent).toBe('Modal'); expect(host.querySelectorAll('.xd-prototype-overlay')).toHaveLength(1); expect(host.querySelector('[role=alert]')).toBeNull();
  } finally { animation.restore(); }
});

it('rolls back session-variable prefixes and prepared artwork when a drag is canceled', async () => {
  const graph = editor.graph, collection = graph.createCollection('Drag variables'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(first, 'width', width.id);
  dragCards({ action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 360 }, transition: 'instant', duration: 0 }, { action: 'navigate', target: second, transition: 'smart', duration: 300, easing: 'linear' }] }); const before = serializeGraph(graph), animation = dragMotion();
  try { await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => dragPointer(host.querySelector<HTMLElement>('[data-name="Drag card"]')!, 'pointerdown', 40, 0)); await act(async () => dragPointer(document, 'pointermove', 80, 100)); expect(host.querySelector('h2')?.textContent).toBe('Details'); await act(async () => dragPointer(document, 'pointercancel', 80, 200)); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector<HTMLElement>('.xd-prototype-stage > .xd-prototype-screen')!.style.width).toBe('320px'); expect(serializeGraph(graph)).toBe(before); }
  finally { animation.restore(); }
});
it('recovers failed drag preparation with an operable original screen and a retained reason', async () => {
  dragCards(); editor.graph.updateNode(second, { width: 0 }); await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => dragPointer(host.querySelector<HTMLElement>('[data-name="Drag card"]')!, 'pointerdown', 40, 0)); await act(async () => dragPointer(document, 'pointermove', 80, 100)); expect(host.querySelector('h2')?.textContent).toBe('Home'); expect(host.querySelector('footer')?.textContent).toContain('positive'); expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect(host.querySelector('.xd-prototype-stage > .xd-prototype-screen > .xd-prototype-content')?.hasAttribute('inert')).toBe(false);
});
it('scrubs a reduced-motion fade and commits without matched geometry', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true })); dragCards(); const animation = dragMotion();
  try { await act(async () => root.render(<PrototypePreviewDialog close={close} />)); await act(async () => dragPointer(host.querySelector<HTMLElement>('[data-name="Drag card"]')!, 'pointerdown', 40, 0)); await act(async () => dragPointer(document, 'pointermove', 240, 100)); expect(animation.jobs).toHaveLength(1); expect(animation.jobs[0]!.frames.every(frame => !frame.transform)).toBe(true); expect(animation.jobs[0]!.currentTime).toBe(125); const previous = animation.jobs.length; await act(async () => dragPointer(document, 'pointerup', 240, 200)); await act(async () => animation.jobs.slice(previous).forEach(job => job.finish())); expect(host.querySelector('h2')?.textContent).toBe('Details'); expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); }
  finally { animation.restore(); }
});
