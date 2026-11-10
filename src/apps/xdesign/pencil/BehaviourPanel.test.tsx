import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BehaviourPanel } from './BehaviourPanel';
import { BehaviourPreviewDialog } from './BehaviourPreviewDialog';
import * as runtime from './runtime';
import { bindComponentProperty, createComponentProperty } from './componentProperties';
import { createSlot, installSlotSupport } from './slots';
import { readBehaviour } from './behaviour/model';
import { setComponentBehaviour } from './behaviour/editor';
import { ComponentBehaviourPreview } from './behaviour/preview';
import { serializeGraph } from './document';
import { isDesignDialogOpen } from '../useDesignDialog';
import { CanvasPreviewContext } from './CanvasPreviewContext';
import { xdesignActivityReason } from '../runtimeActivity';

let editor: Editor, root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  editor = createEditor(); installSlotSupport(editor.graph);
  runtime.usePencilWorkspace.setState({ editor, busy: false });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  vi.spyOn(runtime, 'initializeCanvasKit').mockResolvedValue({} as CanvasKit);
  vi.spyOn(ComponentBehaviourPreview.prototype, 'attachRenderer').mockResolvedValue(undefined);
  // Model, bindings, graph edits and keyboard input are real; only image output is stubbed here.
  vi.spyOn(ComponentBehaviourPreview.prototype, 'render').mockImplementation(function () {
    return { url: 'data:image/png;base64,', bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 }, width: 200, height: 100 };
  });
});
afterEach(() => {
  act(() => root.unmount()); editor.dispose();
  runtime.usePencilWorkspace.setState({ editor: null });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
it('plays an isolated control on the actual canvas, blocks source editing and releases its portal and guards',async()=>{
  const owner=editor.graph.createNode('COMPONENT',editor.state.currentPageId,{name:'Inline checkbox',x:80,y:60,width:200,height:100});
  const property=createComponentProperty(editor,owner,'Checked','BOOLEAN','false');const mark=editor.graph.createNode('RECTANGLE',owner.id,{name:'Mark',visible:false});bindComponentProperty(editor,mark,'VISIBLE',property);setComponentBehaviour(editor,owner,{kind:'checkbox',values:{value:'Checked'}});
  const workspace=document.createElement('section');workspace.className='xd-pencil';const body=document.createElement('div');body.className='xd-editor-body';const canvas=document.createElement('div'),panel=document.createElement('aside');body.append(canvas,panel);workspace.append(body);document.body.append(workspace);
  const before=serializeGraph(editor.graph);
  await act(async()=>root.render(<CanvasPreviewContext.Provider value={canvas}><BehaviourPanel node={owner}/></CanvasPreviewContext.Provider>));
  const trigger=[...container.querySelectorAll('button')].find(button=>button.textContent==='Try on canvas')!;trigger.focus();await act(async()=>trigger.click());
  expect(canvas.querySelector('[role="dialog"]')).not.toBeNull();expect(panel.hasAttribute('inert')).toBe(true);expect(isDesignDialogOpen()).toBe(true);expect(xdesignActivityReason()).toContain('preview');
  const checkbox=canvas.querySelector('[role="checkbox"]') as HTMLButtonElement;await act(async()=>checkbox.click());expect(checkbox.getAttribute('aria-checked')).toBe('true');expect(serializeGraph(editor.graph)).toBe(before);
  await act(async()=>[...canvas.querySelectorAll('button')].find(button=>button.textContent==='Close preview')!.click());
  expect(canvas.children).toHaveLength(0);expect(panel.hasAttribute('inert')).toBe(false);expect(isDesignDialogOpen()).toBe(false);expect(xdesignActivityReason()).toBeNull();expect(document.activeElement).toBe(trigger);workspace.remove();
});
it('closes a native interaction preview when its source graph changes',async()=>{
  const owner=editor.graph.createNode('COMPONENT',editor.state.currentPageId,{name:'Button'});setComponentBehaviour(editor,owner,{kind:'button'});const close=vi.fn();
  await act(async()=>root.render(<BehaviourPreviewDialog node={owner} close={close}/>));await act(async()=>editor.graph.updateNode(owner.id,{name:'Changed'}));expect(close).toHaveBeenCalled();
});
const main = (name = 'Control') => editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name, width: 200, height: 100 });
const render = (node: SceneNode) => act(async () => root.render(<BehaviourPanel node={node}/>));
const select = async (label: string, value: string) => act(async () => {
  const element = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }));
});
const click = (text: string) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click());
function slot(owner: SceneNode, name: string) {
  const frame = editor.graph.createNode('FRAME', owner.id, { name, width: 200, height: 40 });
  createSlot(editor, frame); return frame;
}

it('authors required bindings, opens an isolated preview and returns keyboard focus', async () => {
  const owner = main('Checkbox'), indicator = editor.graph.createNode('RECTANGLE', owner.id, { visible: false });
  const property = createComponentProperty(editor, owner, 'Checked', 'BOOLEAN', 'false');
  bindComponentProperty(editor, indicator, 'VISIBLE', property);
  await render(owner); await select('Component behavior', 'checkbox'); await render(owner);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Bind value');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Preview interactions')?.disabled).toBe(true);
  await select('Bind behavior value', 'Checked'); await render(owner);
  expect(readBehaviour(owner)?.booleans.value?.propertyId).toBe(property);
  const before = serializeGraph(editor.graph), origin = [...container.querySelectorAll('button')].find(button => button.textContent === 'Preview interactions')!;
  origin.focus(); await click('Preview interactions');
  expect(isDesignDialogOpen()).toBe(true);
  const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  await act(async () => checkbox.click()); expect(checkbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => container.querySelector<HTMLInputElement>('.xd-behaviour-preview-footer input')!.click());
  expect(checkbox.disabled).toBe(true); expect(serializeGraph(editor.graph)).toBe(before);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(isDesignDialogOpen()).toBe(false); expect(document.activeElement).toBe(origin);
});

it('keeps a locked component intact and reports the authoring failure', async () => {
  const owner = main(); editor.graph.updateNode(owner.id, { locked: true });
  await render(owner); await select('Component behavior', 'button');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('unlocked');
  expect(readBehaviour(owner)).toBeNull();
});

it('navigates tab selections with arrows and Home/End, exposes panels and uses one tab stop', async () => {
  const owner = main('Settings'), list = slot(owner, 'List'), panels = slot(owner, 'Panels');
  for (const [index, name] of ['General', 'Advanced', 'About'].entries()) {
    editor.graph.createNode('RECTANGLE', list.id, { name, x: index * 60, width: 60, height: 30 });
    const panel = editor.graph.createNode('FRAME', panels.id, { name: `${name} panel` });
    editor.graph.createNode('TEXT', panel.id, { text: `${name} content` });
  }
  setComponentBehaviour(editor, owner, { kind: 'tabs', parts: { list: 'List', panels: 'Panels' } });
  await act(async () => root.render(<BehaviourPreviewDialog node={owner} close={vi.fn()}/>));
  const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Settings');
  expect(tabs().map(tab => tab.tabIndex)).toEqual([0, -1, -1]); tabs()[0]!.focus();
  const key = (value: string) => act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  await key('ArrowRight'); expect(document.activeElement).toBe(tabs()[1]);
  expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  expect([...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')].map(panel => panel.hidden)).toEqual([true, false, true]);
  await key('End'); expect(document.activeElement).toBe(tabs()[2]);
  await key('ArrowRight'); expect(document.activeElement).toBe(tabs()[0]);
  await key('Home'); expect(tabs().map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  expect(container.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs()[0]!.id);
});

it('skips disabled radios with keyboard navigation', async () => {
  const item = main('Option'), checked = createComponentProperty(editor, item, 'Checked', 'BOOLEAN', 'false'), disabled = createComponentProperty(editor, item, 'Disabled', 'BOOLEAN', 'false');
  setComponentBehaviour(editor, item, { kind: 'radio', values: { value: 'Checked', disabled: 'Disabled' } });
  const owner = main('Choices'), items = slot(owner, 'Items');
  editor.graph.createInstance(item.id, items.id, { name: 'First' });
  const blocked = editor.graph.createInstance(item.id, items.id, { name: 'Disabled' })!;
  editor.setInstanceComponentProperty(blocked.id, disabled, 'true');
  editor.graph.createInstance(item.id, items.id, { name: 'Last' });
  setComponentBehaviour(editor, owner, { kind: 'radioGroup', parts: { items: 'Items' } });
  await act(async () => root.render(<BehaviourPreviewDialog node={owner} close={vi.fn()}/>));
  const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios[1]!.disabled).toBe(true); radios[0]!.focus();
  await act(async () => radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(radios[2]); expect(radios[2]!.getAttribute('aria-checked')).toBe('true');
  expect(radios[1]!.getAttribute('aria-checked')).toBe('false'); void checked;
});

it('disposes a closed preview before delayed renderer initialization completes', async () => {
  const owner = main(); setComponentBehaviour(editor, owner, { kind: 'button' });
  let resolve!: (value: CanvasKit) => void;
  vi.mocked(runtime.initializeCanvasKit).mockReturnValue(new Promise(value => { resolve = value; }));
  const dispose = vi.spyOn(ComponentBehaviourPreview.prototype, 'dispose');
  await act(async () => root.render(<BehaviourPreviewDialog node={owner} close={vi.fn()}/>));
  await act(async () => root.render(null)); expect(dispose).toHaveBeenCalledTimes(1);
  await act(async () => resolve({} as CanvasKit));
  expect(ComponentBehaviourPreview.prototype.render).not.toHaveBeenCalled();
  expect(isDesignDialogOpen()).toBe(false);
});

it('exposes progress as a read-only meter with a separate preview value control', async () => {
  const owner = main('Upload'), track = slot(owner, 'Track'), indicator = slot(owner, 'Indicator');
  setComponentBehaviour(editor, owner, { kind: 'progress', parts: { track: 'Track', indicator: 'Indicator' }, numbers: { value: { min: 20, max: 120, step: 10, default: 70 } } });
  await act(async () => root.render(<BehaviourPreviewDialog node={owner} close={vi.fn()}/>));
  const meter = container.querySelector('progress')!;
  expect(meter.max).toBe(100); expect(meter.value).toBe(50);
  expect(container.querySelector('[aria-label="Preview Upload value"]')).toBeTruthy();
  expect(container.querySelector('.xd-behaviour-preview-control input')).toBeNull(); void track; void indicator;
});
