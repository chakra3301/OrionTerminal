import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { PrototypePanel } from './PrototypePanel';
import { readPrototype, setPrototypeInteractions, setNavigation } from './prototype';
import { usePencilWorkspace } from './runtime';
import { readPrototypeOverlay } from './prototypeOverlay';
import { designActions, designSpringDuration, type DesignSpring } from './reactExportRuntime';
let editor: Editor, root: Root, host: HTMLDivElement, node: SceneNode;
const render = () => act(() => root.render(<PrototypePanel node={node} />));
it('authors Smart Animate and directional matching and clears incompatible options on action/transition changes', () => {
  render(); click('Add interaction'); select('Prototype transition 1', 'smart'); expect(readPrototype(node).link?.transition).toBe('smart'); expect(host.querySelector('[aria-label="Smart animate matching layers 1"]')).toBeNull();
  select('Prototype transition 1', 'push'); act(() => host.querySelector<HTMLInputElement>('[aria-label="Smart animate matching layers 1"]')!.click()); render(); expect(readPrototype(node).link?.matchLayers).toBe(true);
  select('Prototype transition 1', 'slide'); expect(readPrototype(node).link?.matchLayers).toBe(true); select('Prototype action 1', 'overlay'); expect(readPrototype(node).link?.matchLayers).toBeUndefined(); expect(host.querySelector('[value="smart"]')).toBeNull();
  select('Prototype action 1', 'swap'); select('Prototype transition 1', 'smart'); select('Prototype action 1', 'close'); expect(readPrototype(node).link).toMatchObject({ action: 'close', transition: 'dissolve' }); editor.undoAction(); render(); expect(readPrototype(node).link).toMatchObject({ action: 'swap', transition: 'smart' });
  select('Prototype transition 1', 'push'); act(() => host.querySelector<HTMLInputElement>('[aria-label="Smart animate matching layers 1"]')!.click()); render(); select('Prototype transition 1', 'dissolve'); expect(readPrototype(node).link?.matchLayers).toBeUndefined(); expect(usePencilWorkspace.getState().error).toBeNull();
});
it('authors directional transitions, long durations and physical springs with validation and undo', () => {
  render(); click('Add interaction');
  for (const transition of ['move-in', 'move-out', 'push', 'slide', 'slide-out']) { select('Prototype transition 1', transition); select('Prototype direction 1', 'top'); expect(readPrototype(node).link).toMatchObject({ transition, direction: 'top' }); }
  number('Prototype duration 1', '10000'); expect(readPrototype(node).link?.duration).toBe(10000); select('Prototype easing 1', 'spring');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Prototype duration 1"]')!.disabled).toBe(true);
  number('Prototype spring 1 mass', '2'); number('Prototype spring 1 stiffness', '160'); number('Prototype spring 1 damping', '20'); number('Prototype spring 1 initialVelocity', '-1');
  const easing: DesignSpring = { type: 'spring', mass: 2, stiffness: 160, damping: 20, initialVelocity: -1 }; expect(readPrototype(node).link).toMatchObject({ easing, duration: designSpringDuration(easing) });
  number('Prototype spring 1 damping', '0.01'); expect(usePencilWorkspace.getState().error).toContain('valid'); expect(readPrototype(node).link?.easing).toEqual(easing);
  editor.undoAction(); render(); expect(readPrototype(node).link?.easing).toEqual({ ...easing, initialVelocity: 0 });
  select('Prototype easing 1', 'linear'); expect(host.querySelector<HTMLInputElement>('[aria-label="Prototype duration 1"]')!.disabled).toBe(false); expect(host.querySelector('[aria-label="Prototype spring 1 mass"]')).toBeNull();
});
const click = (text: string) => { act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click()); render(); };
function select(label: string, value: string) { const field = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; act(() => { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }); render(); }
function number(label: string, value: string) { const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; act(() => { field.value = value; field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); render(); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); editor = createEditor(); node = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Home' }); editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Details' });
  usePencilWorkspace.setState({ editor, error: null }); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

it('authors open, close and swap actions together with frame overlay settings and native undo', () => {
  render(); click('Add interaction'); select('Prototype action 1', 'overlay'); number('Prototype overlay offset 1 x', '-10'); number('Prototype overlay offset 1 y', '24');
  select('Overlay position', 'manual'); select('Overlay background', 'color'); number('Overlay background opacity', '50'); act(() => host.querySelector<HTMLInputElement>('[aria-label="Close overlay on outside click"]')!.click()); render();
  expect(readPrototype(node).link).toMatchObject({ action: 'overlay', offset: { x: -10, y: 24 } }); expect(readPrototypeOverlay(node).settings).toMatchObject({ position: 'manual', closeOutside: true, background: { a: 0.5 } });
  select('Prototype action 1', 'swap'); expect(readPrototype(node).link?.offset).toEqual({ x: -10, y: 24 }); select('Prototype action 1', 'close'); expect(readPrototype(node).link).toEqual({ action: 'close', transition: 'instant', duration: 250 }); editor.undoAction(); expect(readPrototype(node).link?.action).toBe('swap');
});
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); usePencilWorkspace.setState({ editor: null }); vi.unstubAllGlobals(); });
it('authors, changes and removes multiple interactions with native undo', () => {
  render(); click('Add interaction'); click('Add interaction'); expect(readPrototype(node).interactions).toHaveLength(2);
  select('Prototype trigger 2', 'pointer-enter'); number('Prototype delay 2', '125'); select('Prototype transition 2', 'slide'); select('Prototype direction 2', 'left'); select('Prototype easing 2', 'custom'); number('Prototype Bézier 2 2', '0.2');
  expect(readPrototype(node).interactions?.[1]).toMatchObject({ trigger: { type: 'pointer-enter', delay: 125 }, navigation: { transition: 'slide', direction: 'left', easing: [0.25, 0.2, 0.25, 1] } });
  click('Remove interaction 1'); expect(readPrototype(node).interactions).toHaveLength(1); editor.undoAction(); expect(readPrototype(node).interactions).toHaveLength(2);
});
it('captures a keyboard chord and reports rejected duplicate triggers without losing prior actions', () => {
  render(); click('Add interaction'); click('Add interaction'); select('Prototype trigger 2', 'key');
  act(() => host.querySelector('[aria-label="Prototype shortcut 2"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true, bubbles: true }))); render();
  expect(readPrototype(node).interactions?.[1]?.trigger).toEqual({ type: 'key', keyCodes: [16, 75, 91] });
  select('Prototype trigger 2', 'click'); expect(usePencilWorkspace.getState().error).toContain('valid'); expect(readPrototype(node).interactions?.[1]?.trigger.type).toBe('key');
});
it('keeps unsupported imported actions until explicitly removed and disables additions over them', () => {
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_VOICE' }, actions: [{ connectionType: 'BACK' }] }] }; render();
  expect(host.querySelector('[role=status]')?.textContent).toContain('preserved'); expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Add interaction')!.disabled).toBe(true);
  click('Remove interactions'); click('Add interaction'); expect(readPrototype(node).interactions).toHaveLength(1); expect(node.source.fig.rawNodeFields.prototypeInteractions).toHaveLength(1);
});
it('respects locked ancestors and repairs missing destinations before changing unrelated fields', () => {
  const destination = editor.graph.getChildren(editor.state.currentPageId).find(screen => screen.name === 'Details')!;
  setPrototypeInteractions(editor, node, [{ id: 'click', trigger: { type: 'click' }, navigation: { action: 'navigate', target: destination.id, transition: 'instant', duration: 0 } }]); editor.graph.deleteNode(destination.id); render();
  expect(host.querySelector('[aria-label="Prototype destination 1"]')?.textContent).toContain('Missing screen'); select('Prototype destination 1', node.id); expect(readPrototype(node).link?.target).toBe(node.id);
  editor.graph.updateNode(node.id, { locked: true }); click('Remove interaction 1'); expect(usePencilWorkspace.getState().error).toContain('Unlock'); expect(readPrototype(node).interactions).toHaveLength(1);
});

it('chooses an unused delay when adding over an existing click and timed interaction', () => {
  const navigation = { action: 'back' as const, transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, node, [{ id: 'click', trigger: { type: 'click' }, navigation }, { id: 'delay', trigger: { type: 'delay', delay: 3000 }, navigation }]); render(); click('Add interaction');
  expect(readPrototype(node).interactions).toHaveLength(3); expect(readPrototype(node).interactions?.[2]?.trigger).toEqual({ type: 'delay', delay: 1000 }); expect(usePencilWorkspace.getState().error).toBeNull();
});
it('repairs several unresolved copied destinations one at a time and retains the others through undo', () => {
  node.pluginData = [{ pluginId: 'orion.xdesign', key: 'prototypeInteractions', value: JSON.stringify([
    { id: 'click', trigger: { type: 'click' }, navigation: { action: 'navigate', target: 'missing-a', unresolved: true, transition: 'instant', duration: 0 } },
    { id: 'delay', trigger: { type: 'delay', delay: 1000 }, navigation: { action: 'navigate', target: 'missing-b', unresolved: true, transition: 'instant', duration: 0 } },
  ]) }]; render(); select('Prototype destination 1', node.id);
  expect(readPrototype(node).interactions?.[0]?.navigation).toMatchObject({ target: node.id }); expect(readPrototype(node).interactions?.[1]?.navigation).toMatchObject({ target: 'missing-b', unresolved: true });
  select('Prototype destination 2', node.id); expect(readPrototype(node).interactions?.every(interaction => !interaction.navigation.unresolved && interaction.navigation.target === node.id)).toBe(true);
  editor.undoAction(); expect(readPrototype(node).interactions?.[1]?.navigation.unresolved).toBe(true); editor.redoAction(); expect(readPrototype(node).interactions?.[1]?.navigation.unresolved).toBeUndefined(); expect(usePencilWorkspace.getState().error).toBeNull();
});

it('authors scroll directions, local targets, offsets, animation and mutually exclusive arrival options', async () => {
  const { readPrototypeScroll } = await import('./prototypeScroll');
  const child = editor.graph.createNode('TEXT', node.id, { name: 'Footer', text: 'Footer' }); render(); select('Prototype scrolling', 'both'); number('Prototype scroll start x', '15'); number('Prototype scroll start y', '40');
  click('Add interaction'); select('Prototype arrival scroll 1', 'preserve'); expect(readPrototype(node).link?.preserveScroll).toBe(true); select('Prototype arrival scroll 1', 'reset'); expect(readPrototype(node).link).toMatchObject({ resetScroll: true }); expect(readPrototype(node).link?.preserveScroll).toBeUndefined();
  select('Prototype action 1', 'scroll'); expect(readPrototype(node).link).toMatchObject({ action: 'scroll', target: child.id }); expect(readPrototype(node).link?.resetScroll).toBeUndefined();
  select('Prototype transition 1', 'scroll'); number('Prototype scroll offset 1 y', '-12'); expect(readPrototype(node).link).toMatchObject({ transition: 'scroll', offset: { x: 0, y: -12 } }); expect(readPrototypeScroll(node).settings).toEqual({ axis: 'both', initial: { x: 15, y: 40 } });
  expect(host.querySelector('[aria-label="Prototype destination 1"]')?.textContent).toBe('Footer'); select('Prototype action 1', 'navigate'); expect(readPrototype(node).link?.transition).toBe('instant'); expect(readPrototype(node).link?.offset).toBeUndefined();
});
it('authors and clears reset-interactive-components on supported navigation actions', () => {
  editor.graph.createNode('RECTANGLE', node.id, { name: 'Scroll target' });
  render(); click('Add interaction');
  const reset = host.querySelector<HTMLInputElement>('[aria-label="Reset interactive components 1"]')!;
  act(() => reset.click()); render(); expect(readPrototype(node).link?.resetInteractiveComponents).toBe(true);
  act(() => host.querySelector<HTMLInputElement>('[aria-label="Reset interactive components 1"]')!.click()); render(); expect(readPrototype(node).link?.resetInteractiveComponents).toBe(false);
  select('Prototype action 1', 'scroll'); expect(host.querySelector('[aria-label="Reset interactive components 1"]')).toBeNull(); expect(readPrototype(node).link?.resetInteractiveComponents).toBeUndefined();
});
it('authors explicit video reset true and false, restores it with Undo and clears it on non-route action changes',()=>{
  editor.graph.createNode('RECTANGLE',node.id,{name:'Video scroll target'});const collection=editor.graph.createCollection('Video reset control'),variable=editor.graph.createVariable('Enabled','BOOLEAN',collection.id,false);
  render();click('Add interaction');const reset=()=>host.querySelector<HTMLInputElement>('[aria-label="Reset video position 1"]')!;
  expect(reset().checked).toBe(false);act(()=>reset().click());render();expect(readPrototype(node).link?.resetVideoPosition).toBe(true);
  act(()=>reset().click());render();expect(readPrototype(node).link?.resetVideoPosition).toBe(false);editor.undoAction();render();expect(reset().checked).toBe(true);expect(readPrototype(node).link?.resetVideoPosition).toBe(true);
  select('Prototype action 1','scroll');expect(readPrototype(node).link?.resetVideoPosition).toBeUndefined();expect(host.querySelector('[aria-label="Reset video position 1"]')).toBeNull();
  select('Prototype action 1','navigate');act(()=>reset().click());render();select('Prototype action 1','set-variable');expect(readPrototype(node).link).toMatchObject({action:'set-variable',variable:variable.id});expect(readPrototype(node).link?.resetVideoPosition).toBeUndefined();expect(reset()).toBeNull();
  expect(usePencilWorkspace.getState().error).toBeNull();
});
it('authors Open link with exact URL and explicit new-tab values, Undo, and route-only option cleanup', () => {
  editor.graph.createNode('RECTANGLE', node.id, { name: 'Scroll destination' });
  render(); click('Add interaction'); select('Prototype transition 1', 'push');
  act(() => host.querySelector<HTMLInputElement>('[aria-label="Reset video position 1"]')!.click()); render();
  select('Prototype action 1', 'open-url');
  expect(readPrototype(node).link).toEqual({ action: 'open-url', url: 'https://example.com/', newTab: true, transition: 'instant', duration: 0 });
  expect(host.querySelector('[aria-label="Prototype transition 1"]')).toBeNull(); expect(host.querySelector('[aria-label="Prototype destination 1"]')).toBeNull(); expect(host.querySelector('[aria-label="Reset video position 1"]')).toBeNull();
  const url = 'https://Example.com/a%20b?x=%2F#anchor'; number('Prototype URL 1', url);
  act(() => host.querySelector<HTMLInputElement>('[aria-label="Open link in new tab 1"]')!.click()); render();
  expect(readPrototype(node).link).toEqual({ action: 'open-url', url, newTab: false, transition: 'instant', duration: 0 });
  editor.undoAction(); render(); expect(readPrototype(node).link?.newTab).toBe(true); expect(host.querySelector<HTMLInputElement>('[aria-label="Prototype URL 1"]')!.value).toBe(url);
  editor.redoAction(); render(); expect(readPrototype(node).link?.newTab).toBe(false);
  select('Prototype trigger 1', 'hover'); expect(host.textContent).toContain('Ending the hold restores local changes; opened links stay open.'); expect(host.textContent).not.toContain('Navigation returns to its starting route when the hold ends.');
  select('Prototype trigger 1', 'drag'); expect(host.textContent).toContain('Dragging opens links when it starts; local actions follow the drag and release.');
  select('Prototype action 1', 'scroll'); const action = readPrototype(node).interactions?.[0]?.navigation;
  expect(readPrototype(node).link).toBeUndefined(); expect(readPrototype(node).interactions?.[0]?.trigger.type).toBe('drag');
  expect(action).toMatchObject({ action: 'scroll' }); expect(action?.url).toBeUndefined(); expect(action?.newTab).toBeUndefined(); expect(host.querySelector('[aria-label="Prototype URL 1"]')).toBeNull();
  expect(host.textContent).toContain('Drag follows the transition; release commits or returns to its starting state.');
  expect(usePencilWorkspace.getState().error).toBeNull();
});
it('authors targeted video playback on screen and child video layers, with native Undo and action cleanup', () => {
  const fill={type:'VIDEO' as const,visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}};
  node.fills=[fill];const video=editor.graph.createNode('RECTANGLE',node.id,{name:'Child video',fills:[fill]});editor.graph.createNode('RECTANGLE',node.id,{name:'Hidden video',visible:false,fills:[fill]});
  render();click('Add interaction');select('Prototype transition 1','push');act(()=>host.querySelector<HTMLInputElement>('[aria-label="Reset video position 1"]')!.click());render();
  select('Prototype action 1','media');expect(readPrototype(node).link).toEqual({action:'media',mediaAction:'play',target:node.id,transition:'instant',duration:0});
  expect(host.querySelector('[aria-label="Prototype transition 1"]')).toBeNull();expect(host.querySelector('[aria-label="Reset video position 1"]')).toBeNull();
  const targets=host.querySelector<HTMLSelectElement>('[aria-label="Prototype video target 1"]')!;expect([...targets.options].map(option=>option.textContent)).toEqual(['Home','Child video']);
  select('Prototype video action 1','pause');select('Prototype video target 1',video.id);expect(readPrototype(node).link).toMatchObject({action:'media',mediaAction:'pause',target:video.id});
  editor.undoAction();render();expect(readPrototype(node).link?.target).toBe(node.id);editor.redoAction();render();expect(readPrototype(node).link?.target).toBe(video.id);
  select('Prototype video action 1','toggle');expect(readPrototype(node).link?.mediaAction).toBe('toggle');
  select('Prototype trigger 1','hover');expect(host.textContent).toContain('Ending the hold restores video playback and local changes.');
  select('Prototype trigger 1','drag');expect(host.textContent).toContain('Dragging controls video playback; release commits or restores its starting playback.');
  select('Prototype trigger 1','click');
  select('Prototype action 1','open-url');expect(readPrototype(node).link?.mediaAction).toBeUndefined();expect(readPrototype(node).link?.target).toBeUndefined();expect(host.querySelector('[aria-label="Prototype video target 1"]')).toBeNull();expect(usePencilWorkspace.getState().error).toBeNull();
});
it('offers only videos in the screen reached by an earlier action in the same interaction', () => {
  const fill={type:'VIDEO' as const,visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}, graph=editor.graph, details=graph.getChildren(editor.state.currentPageId).find(frame=>frame.name==='Details')!;
  graph.createNode('RECTANGLE',node.id,{name:'Home clip',fills:[fill]});const video=graph.createNode('RECTANGLE',details.id,{name:'Details clip',fills:[fill]});
  render();click('Add interaction');select('Prototype destination 1',details.id);click('Add action to interaction 1');select('Prototype action 1 step 2','media');
  expect(designActions(readPrototype(node).link!)[1]).toEqual({action:'media',mediaAction:'play',target:video.id,transition:'instant',duration:0});
  expect([...host.querySelector<HTMLSelectElement>('[aria-label="Prototype video target 1 step 2"]')!.options].map(option=>option.textContent)).toEqual(['Details clip']);expect(usePencilWorkspace.getState().error).toBeNull();
});
it('uses branch-specific sequential video contexts and disables media authoring when no visible videos are available', () => {
  render();click('Add interaction');expect(host.querySelector<HTMLOptionElement>('[value="media"]')!.disabled).toBe(true);
  const fill={type:'VIDEO' as const,visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}, graph=editor.graph, details=graph.getChildren(editor.state.currentPageId).find(frame=>frame.name==='Details')!;
  const homeVideo=graph.createNode('RECTANGLE',node.id,{name:'Branch Home clip',fills:[fill]}), detailsVideo=graph.createNode('RECTANGLE',details.id,{name:'Branch Details clip',fills:[fill]});render();
  select('Prototype action 1','conditional');click('Add branch action');select('Prototype action 1 branch 1 step 1','media');expect(readPrototype(node).link?.branches?.[0]?.actions[0]?.target).toBe(homeVideo.id);
  click('Add branch action');select('Prototype action 1 branch 1 step 2','navigate');select('Prototype destination 1 branch 1 step 2',details.id);
  click('Add branch action');select('Prototype action 1 branch 1 step 3','media');expect(readPrototype(node).link?.branches?.[0]?.actions[2]).toMatchObject({action:'media',mediaAction:'play',target:detailsVideo.id});
  expect([...host.querySelector<HTMLSelectElement>('[aria-label="Prototype video target 1 branch 1 step 3"]')!.options].map(option=>option.textContent)).toEqual(['Branch Details clip']);expect(usePencilWorkspace.getState().error).toBeNull();
});
it('keeps nonmedia controls usable when video enumeration exceeds its layer budget without rendering the target list', () => {
  const graph=editor.graph, example=graph.createNode('RECTANGLE',node.id,{name:'Enumeration template'}), getChildren=graph.getChildren.bind(graph);
  const children=Array.from({length:20001},(_,index)=>({...example,id:`media-enumeration-${index}`,childIds:[]}));
  const spy=vi.spyOn(graph,'getChildren').mockImplementation(id=>id===node.id?children:getChildren(id));
  try {
    render();click('Add interaction');
    expect(host.querySelector('[aria-label="Prototype transition 1"]')).not.toBeNull();expect(host.textContent).toContain('20,000 layers');expect(host.querySelector<HTMLOptionElement>('[value="media"]')!.disabled).toBe(true);
    select('Prototype action 1','open-url');expect(readPrototype(node).link).toMatchObject({action:'open-url',url:'https://example.com/'});expect(host.querySelector('[aria-label="Prototype URL 1"]')).not.toBeNull();expect(usePencilWorkspace.getState().error).toBeNull();
  } finally {spy.mockRestore();}
});
it('edits inherited instance video actions without a missing target, preserving the master and an explicit sibling choice', () => {
  const graph=editor.graph, frame=node, fill={type:'VIDEO' as const,visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}, main=graph.createNode('COMPONENT',editor.state.currentPageId), templateVideo=graph.createNode('RECTANGLE',main.id,{name:'Instance clip',fills:[fill]}), templateButton=graph.createNode('RECTANGLE',main.id,{name:'Instance button'});
  setNavigation(editor,templateButton,{action:'media',mediaAction:'play',target:templateVideo.id,transition:'instant',duration:0});
  const first=graph.createInstance(main.id,frame.id)!, second=graph.createInstance(main.id,frame.id)!;
  node=graph.getChildren(first.id).find(child=>child.componentId===templateButton.id)!;
  const ownVideo=graph.getChildren(first.id).find(child=>child.componentId===templateVideo.id)!, otherVideo=graph.getChildren(second.id).find(child=>child.componentId===templateVideo.id)!, master=structuredClone(templateButton.pluginData);
  render();expect(host.querySelector<HTMLSelectElement>('[aria-label="Prototype video target 1"]')!.value).toBe(ownVideo.id);expect(host.textContent).not.toContain('Missing video');
  select('Prototype video action 1','pause');expect(readPrototype(node).link).toEqual({action:'media',mediaAction:'pause',target:ownVideo.id,transition:'instant',duration:0});
  select('Prototype video target 1',otherVideo.id);expect(readPrototype(node).link?.target).toBe(otherVideo.id);expect(templateButton.pluginData).toEqual(master);
  editor.undoAction();render();expect(readPrototype(node).link?.target).toBe(ownVideo.id);editor.undoAction();render();expect(readPrototype(node).link?.target).toBe(templateVideo.id);expect(host.querySelector<HTMLSelectElement>('[aria-label="Prototype video target 1"]')!.value).toBe(ownVideo.id);expect(templateButton.pluginData).toEqual(master);expect(usePencilWorkspace.getState().error).toBeNull();
});
it('rejects invalid URL edits through the inspector without overwriting the saved action or native history', () => {
  render(); click('Add interaction'); select('Prototype action 1', 'open-url'); number('Prototype URL 1', 'mailto:hello@example.com?subject=Hello%20there');
  const previous = readPrototype(node).link, undo = editor.undo.canUndo, redo = editor.undo.canRedo;
  for (const invalid of ['javascript:alert(1)', '/relative', 'https://', ' https://example.com/', 'https:\\example.com/next']) {
    number('Prototype URL 1', invalid); expect(usePencilWorkspace.getState().error).toContain('valid'); expect(readPrototype(node).link).toEqual(previous); expect(editor.undo.canUndo).toBe(undo); expect(editor.undo.canRedo).toBe(redo);
  }
  number('Prototype URL 1', 'tel:+1-555-0100'); expect(readPrototype(node).link?.url).toBe('tel:+1-555-0100'); editor.undoAction(); render(); expect(readPrototype(node).link).toEqual(previous);
});
it('authors URL steps inside conditional branches and sequences without changing other actions', () => {
  render(); click('Add interaction'); click('Add action to interaction 1'); select('Prototype action 1 step 2', 'open-url'); number('Prototype URL 1 step 2', 'http://example.com/second');
  const first = designActions(readPrototype(node).link!)[0];
  expect(designActions(readPrototype(node).link!)[1]).toEqual({ action: 'open-url', url: 'http://example.com/second', newTab: true, transition: 'instant', duration: 0 });
  select('Prototype action 1 step 2', 'conditional'); click('Add branch action'); select('Prototype action 1 step 2 branch 1 step 1', 'open-url'); number('Prototype URL 1 step 2 branch 1 step 1', 'https://example.com/branch');
  expect(designActions(readPrototype(node).link!)[0]).toEqual(first); expect(designActions(readPrototype(node).link!)[1]?.branches?.[0]?.actions).toEqual([{ action: 'open-url', url: 'https://example.com/branch', newTab: true, transition: 'instant', duration: 0 }]);
  expect(usePencilWorkspace.getState().error).toBeNull();
});
it('repairs preserved scroll settings and exposes fixed/sticky positioning for a selected child', async () => {
  const { readPrototypeScroll, readScrollBehaviour } = await import('./prototypeScroll'); node.source.fig.rawNodeFields = { scrollDirection: 'FUTURE' }; render(); expect(host.textContent).toContain('cannot play'); click('Reset scroll settings'); expect(readPrototypeScroll(node).settings.axis).toBe('none'); editor.undoAction(); expect(readPrototypeScroll(node).issue).toBeDefined();
  node = editor.graph.createNode('RECTANGLE', node.id); render(); select('Prototype scroll position', 'fixed'); expect(readScrollBehaviour(node).behaviour).toBe('fixed'); select('Prototype scroll position', 'sticky'); editor.undoAction(); expect(readScrollBehaviour(node).behaviour).toBe('fixed');
});
it('authors, reorders and removes sequence steps with native undo and context-sensitive scroll destinations', () => {
  const details = editor.graph.getChildren(editor.state.currentPageId).find(screen => screen.name === 'Details')!, target = editor.graph.createNode('RECTANGLE', details.id, { name: 'Details footer' });
  render(); click('Add interaction'); select('Prototype destination 1', details.id); click('Add action to interaction 1');
  select('Prototype action 1 step 2', 'scroll'); expect(designActions(readPrototype(node).link!)[1]).toMatchObject({ action: 'scroll', target: target.id });
  select('Prototype action 1 step 2', 'back'); act(() => host.querySelector<HTMLButtonElement>('[aria-label="Move action 2 up in interaction 1"]')!.click()); render(); expect(designActions(readPrototype(node).link!).map(action => action.action)).toEqual(['back', 'navigate']);
  editor.undoAction(); render(); expect(designActions(readPrototype(node).link!).map(action => action.action)).toEqual(['navigate', 'back']);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove action 2 in interaction 1"]')!.click()); render(); expect(readPrototype(node).link?.action).toBe('navigate'); expect(host.querySelector('[aria-label="Prototype destination 1"]')).not.toBeNull();
  editor.undoAction(); render(); expect(readPrototype(node).link?.action).toBe('sequence'); expect(usePencilWorkspace.getState().error).toBeNull();
});
it('offers the original screen after a sequence Back and keeps one-action sequences removable only as interactions', () => {
  const details = editor.graph.getChildren(editor.state.currentPageId).find(screen => screen.name === 'Details')!, footer = editor.graph.createNode('RECTANGLE', node.id, { name: 'Home footer' });
  setPrototypeInteractions(editor, node, [{ id: 'click', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'navigate', target: details.id, transition: 'instant', duration: 0 }, { action: 'back', transition: 'instant', duration: 0 }, { action: 'scroll', target: footer.id, transition: 'instant', duration: 0 }] } }]); render();
  expect(host.querySelector('[aria-label="Prototype destination 1 step 3"]')?.textContent).toBe('Home footer');
  setPrototypeInteractions(editor, node, [{ id: 'click', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'back', transition: 'instant', duration: 0 }] } }]); render();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove action 1 in interaction 1"]')?.disabled).toBe(true); click('Remove interaction 1'); expect(readPrototype(node).interactions).toEqual([]);
});

it('authors typed assignments, expressions, mode changes and conditional branch actions through the inspector with native undo', () => {
  const graph = editor.graph, collection = graph.createCollection('Flow'), count = graph.createVariable('Count', 'FLOAT', collection.id, 0), dark = crypto.randomUUID(); graph.addMode(collection.id, dark, 'Dark'); render(); click('Add interaction'); select('Prototype action 1', 'set-variable'); number('Prototype value 1 literal', '2'); expect(readPrototype(node).link).toMatchObject({ action: 'set-variable', variable: count.id, value: { type: 'literal', value: 2 } });
  select('Prototype value 1 source', 'expression'); select('Prototype value 1 operand 1 source', 'variable'); expect(readPrototype(node).link?.value).toMatchObject({ type: 'expression', operator: 'ADDITION', arguments: [{ type: 'variable', id: count.id }, { type: 'literal', value: 1 }] });
  select('Prototype action 1', 'set-mode'); select('Prototype variable mode 1', dark); expect(readPrototype(node).link).toMatchObject({ action: 'set-mode', collection: collection.id, mode: dark });
  select('Prototype action 1', 'conditional'); click('Add branch action'); select('Prototype action 1 branch 1 step 1', 'set-variable'); expect(readPrototype(node).link?.branches?.[0]?.actions[0]).toMatchObject({ action: 'set-variable', variable: count.id }); editor.undoAction(); render(); expect(readPrototype(node).link?.branches?.[0]?.actions[0]?.action).toBe('back');
});

it('authors held and one-way triggers and exposes video timing only on video layers', async () => {
  render(); click('Add interaction'); select('Prototype trigger 1', 'hover'); number('Prototype delay 1', '125'); expect(readPrototype(node).interactions?.[0]?.trigger).toEqual({ type: 'hover', delay: 125 }); expect(host.textContent).toContain('returns');
  select('Prototype trigger 1', 'press'); select('Prototype trigger 1', 'pointer-down'); select('Prototype trigger 1', 'pointer-up'); expect(readPrototype(node).interactions?.[0]?.trigger.type).toBe('pointer-up');
  expect(host.querySelector<HTMLOptionElement>('[value=media-hit]')!.disabled).toBe(true);
  const { placePreparedVideo } = await import('./videoPaints'); node = editor.graph.getNode(placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Clip', width: 320, height: 180, duration: 3 }, 0, 0))!;
  render(); click('Add interaction'); select('Prototype trigger 1', 'media-hit'); number('Prototype video time 1', '1.25'); expect(readPrototype(node).interactions?.[0]?.trigger).toEqual({ type: 'media-hit', time: 1.25 }); select('Prototype trigger 1', 'media-end'); expect(readPrototype(node).interactions?.[0]?.trigger).toEqual({ type: 'media-end' });
});

it('authors On drag with an action sequence and native undo', () => {
  render(); click('Add interaction'); select('Prototype trigger 1', 'drag'); select('Prototype transition 1', 'smart'); expect(readPrototype(node).interactions![0]!).toMatchObject({ trigger: { type: 'drag' }, navigation: { transition: 'smart' } }); expect(host.textContent).toContain('Drag follows'); click('Add action to interaction 1'); expect(readPrototype(node).interactions![0]!.navigation.actions).toHaveLength(2); editor.undoAction(); render(); expect(readPrototype(node).interactions![0]!.navigation.action).toBe('navigate'); expect(usePencilWorkspace.getState().error).toBeNull();
});
