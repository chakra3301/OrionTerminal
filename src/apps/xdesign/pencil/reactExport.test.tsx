import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { transform } from 'sucrase';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import * as sourceLayout from '@open-pencil/core/layout';
import { getAxisAlignedWorldBounds, getNodeLocalMatrix, getWorldMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { constrainedChildRect, scaledChildRect } from '@open-pencil/scene-graph/resize';
import { createComponentProperty, bindComponentProperty } from './componentProperties';
import { createSlot, installSlotSupport } from './slots';
import { serializeGraph } from './document';
import { setComponentBehaviour } from './behaviour/editor';
import { cloneReactExportGraph, selectionToDesignModel, selectionToReact } from './reactExport';
import { designSpringDuration, type DesignProps, type DesignNavigation, type DesignSpring } from './reactExportRuntime';
import { setPrototypeInteractions, setNavigation } from './prototype';
import { placePreparedVideo, updateVideoAsset, videoAsset } from './videoPaints';
import { setPrototypeOverlay } from './prototypeOverlay';
import { updateDesignProperties } from './propertyMutation';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { assignPrototypeVariable, emptyPrototypeSession, setPrototypeSessionMode } from './prototypeValues';
let editor: Editor, host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); editor = createEditor(); installSlotSupport(editor.graph); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const main = (name: string) => editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name, width: 200, height: 80 });
it('delivers Smart Animate and matching flags with semantic geometry from the exact generated React module', () => {
  const owner = main('Smart export'), target = editor.graph.createNode('FRAME', editor.state.currentPageId), navigate = vi.fn();
  for (const [index, navigation] of [{ action: 'navigate', target: target.id, transition: 'smart', duration: 300, easing: 'ease-in-out' }, { action: 'swap', target: target.id, transition: 'push', matchLayers: true, direction: 'left', duration: 500 }].entries()) { const node = editor.graph.createNode('TEXT', owner.id, { name: `Smart ${index}`, text: 'Play' }); setNavigation(editor, node, navigation as DesignNavigation); }
  const exported = mount(owner, { onNavigate: navigate }); expect(exported.code).toContain('"transition": "smart"'); expect(exported.code).toContain('"matchLayers": true');
  act(() => host.querySelector<HTMLElement>('[data-name="Smart 0"]')!.click()); act(() => host.querySelector<HTMLElement>('[data-name="Smart 1"]')!.click()); expect(navigate.mock.calls.map(call => call[0])).toEqual([{ action: 'navigate', target: target.id, transition: 'smart', duration: 300, easing: 'ease-in-out' }, { action: 'swap', target: target.id, transition: 'push', matchLayers: true, direction: 'left', duration: 500 }]); expect(JSON.parse(host.querySelector('[data-name="Smart 0"]')!.getAttribute('data-xdesign-motion')!)).toMatchObject({ version: 1, type: 'TEXT', name: 'Smart 0' });
});
it('delivers directional transition and physical spring data from the actual exported module without source changes', () => {
  const owner = main('Motion export'), target = editor.graph.createNode('FRAME', editor.state.currentPageId), navigate = vi.fn();
  const navigations: DesignNavigation[] = ['slide', 'slide-out', 'move-in', 'move-out', 'push'].flatMap(transition => ['left', 'right', 'top', 'bottom'].map(direction => ({ action: 'navigate', target: target.id, transition, direction, duration: 4000, easing: [0.25, -1, 0.75, 2] } as DesignNavigation)));
  // Use separate layers because each layer permits at most sixteen interactions.
  for (const [index, navigation] of navigations.entries()) { const node = editor.graph.createNode('TEXT', owner.id, { name: `Motion ${index}`, text: 'Play' }); setNavigation(editor, node, navigation); }
  const easing: DesignSpring = { type: 'spring', mass: 2, stiffness: 160, damping: 20, initialVelocity: -1 }, spring = editor.graph.createNode('TEXT', owner.id, { name: 'Physical spring', text: 'Play' }); setNavigation(editor, spring, { action: 'back', transition: 'push', direction: 'top', duration: 1, easing });
  mount(owner, { onNavigate: navigate });
  const rootMotion = JSON.parse(host.querySelector('[data-xdesign-view] > [data-xdesign-motion]')!.getAttribute('data-xdesign-motion')!); expect(rootMotion).toMatchObject({ version: 1, root: true, name: 'Motion export', type: 'INSTANCE', width: 200, height: 80 });
  for (const [index, navigation] of navigations.entries()) { act(() => host.querySelector<HTMLElement>(`[data-name="Motion ${index}"]`)!.click()); expect(navigate.mock.calls.at(-1)?.[0]).toEqual(navigation); }
  act(() => host.querySelector<HTMLElement>('[data-name="Physical spring"]')!.click()); expect(navigate.mock.calls.at(-1)?.[0]).toEqual({ action: 'back', transition: 'push', direction: 'top', duration: designSpringDuration(easing), easing });
});

it('delivers frame overlay settings and trigger-relative action data in the exact portable React module', () => {
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Dialog', width: 200, height: 100 }), trigger = editor.graph.createNode('TEXT', frame.id, { name: 'Open', text: 'Open', x: 20, y: 30, width: 80, height: 20 });
  setPrototypeOverlay(editor, frame, { position: 'manual', closeOutside: true, background: { r: 0, g: 0, b: 0, a: 0.5 } });
  setNavigation(editor, trigger, { action: 'overlay', target: frame.id, transition: 'instant', duration: 0, offset: { x: 4, y: 8 } });
  const navigate = vi.fn(), result = mount(frame, { onNavigate: navigate }), layer = host.querySelector<HTMLElement>('[data-name=Open]')!;
  act(() => layer.click()); expect(navigate).toHaveBeenCalledWith({ action: 'overlay', target: frame.id, transition: 'instant', duration: 0, offset: { x: 4, y: 8 } }, `${frame.id}/0`, { type: 'click' }, { x: 0, y: 0 });
  expect(result.code).toContain('"closeOutside": true'); expect(result.code).toContain('"position": "manual"');
});
function slot(owner: SceneNode, name: string, width = 200, x = 0) {
  const node = editor.graph.createNode('FRAME', owner.id, { name, width, height: 20, x }); createSlot(editor, node); return node;
}
function booleanControl(kind: 'checkbox' | 'radio' | 'switch' | 'toggle', name: string = kind) {
  const owner = main(name), mark = editor.graph.createNode('RECTANGLE', owner.id, { name: 'Mark', width: 12, height: 12, visible: false });
  const id = createComponentProperty(editor, owner, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', id);
  setComponentBehaviour(editor, owner, { kind, values: { value: 'Checked' } }); return owner;
}
function mount(node: SceneNode | readonly SceneNode[], props: DesignProps = {}) {
  const ids = 'id' in node ? [node.id] : node.map(item => item.id);
  const before = serializeGraph(editor.graph), exported = selectionToReact(editor.graph, ids);
  // Execute the exact delivered module, with React as its only permitted dependency.
  const exports: { default?: React.ComponentType<DesignProps> } = {};
  const code = transform(exported.code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  new Function('require', 'exports', code)((id: string) => { if (id === 'react') return React; if (id === 'react/jsx-runtime') return jsxRuntime; throw new Error(`Unexpected export dependency: ${id}`); }, exports);
  expect(serializeGraph(editor.graph)).toBe(before);
  act(() => root.render(React.createElement(exports.default!, props))); return { ...exported, component: exports.default! };
}
const click = (node: Element) => act(() => (node as HTMLElement).click());
function expectLocalCorners(element: HTMLElement, expected: SceneNode) {
  const width = Number.parseFloat(element.style.width), height = Number.parseFloat(element.style.height);
  expect([width, height]).toEqual([expected.width, expected.height]);
  const matrix = element.style.transform ? element.style.transform.slice(7, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  const origin = element.style.transformOrigin.split(/\s+/), axis = (value: string, size: number) => Number.parseFloat(value) * (value.endsWith('%') ? size / 100 : 1);
  const ox = axis(origin[0]!, width), oy = axis(origin[1]!, height), left = Number.parseFloat(element.style.left) || 0, top = Number.parseFloat(element.style.top) || 0;
  const native = getNodeLocalMatrix(expected);
  for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
    const actual = [left + ox + matrix[0]! * (x! - ox) + matrix[2]! * (y! - oy) + matrix[4]!, top + oy + matrix[1]! * (x! - ox) + matrix[3]! * (y! - oy) + matrix[5]!];
    expect(actual[0]).toBeCloseTo(native[0]! * x! + native[1]! * y! + native[2]!, 8);
    expect(actual[1]).toBeCloseTo(native[3]! * x! + native[4]! * y! + native[5]!, 8);
  }
}
function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
describe('standalone interactive React export', () => {
  it('refuses unsupported imported prototype behavior instead of exporting a silent dead hotspot', () => {
    const node = editor.graph.createNode('FRAME', editor.state.currentPageId);
    node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'AFTER_TIMEOUT' }, actions: [{ connectionType: 'BACK' }] }] };
    expect(() => selectionToReact(editor.graph, [node.id])).toThrow('unsupported prototype');
    setNavigation(editor, node, null); expect(() => selectionToReact(editor.graph, [node.id])).not.toThrow();
  });
  it('exports real video elements with inline resources, accessible controls and disabled playback', () => {
    const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{}),load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
    const id = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Product video', width: 320, height: 180, duration: 3 }, 0, 0);
    const node = editor.graph.getNode(id)!; updateVideoAsset(editor, node, videoAsset(node, node.fills[0]!)!, { autoplay: true, loop: true });
    const result = mount(node), video = host.querySelector('video')!;
    expect(video.src).toBe('data:video/webm;base64,AQID'); expect(video.poster).toBe('data:image/png;base64,iVBORw=='); expect(video.autoplay).toBe(true); expect(video.loop).toBe(true); expect(video.muted).toBe(true); expect(video.controls).toBe(true); expect(video.getAttribute('aria-label')).toBe('Product video');
    act(() => root.render(React.createElement(result.component, { disabled: true }))); expect(video.autoplay).toBe(false); expect(video.controls).toBe(false); expect(video.style.pointerEvents).toBe('none');expect(pause).toHaveBeenCalledOnce();
    act(()=>root.render(null));expect(pause).toHaveBeenCalledTimes(2);expect(load).toHaveBeenCalledOnce();expect(video.hasAttribute('src')).toBe(false);
  });
  it('delivers prototype callbacks for static hotspots and controls without duplicate activation', () => {
    const owner = booleanControl('checkbox'), target = editor.graph.createNode('FRAME', editor.state.currentPageId);
    const link = { action: 'navigate' as const, target: target.id, transition: 'instant' as const, duration: 0 };
    setNavigation(editor, owner, link); const navigate = vi.fn(), change = vi.fn();
    const result = mount(owner, { onNavigate: navigate, onValueChange: change }); click(host.querySelector('button')!);
    expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith(link, owner.id); expect(change).toHaveBeenCalledWith(owner.id, true);
    act(() => root.render(React.createElement(result.component, { disabled: true, onNavigate: navigate }))); click(host.querySelector('button')!); expect(navigate).toHaveBeenCalledTimes(1);
    const text = editor.graph.createNode('TEXT', editor.state.currentPageId, { name: 'Next', text: 'Next', width: 80, height: 20 }); setNavigation(editor, text, link);
    mount(text, { onNavigate: navigate }); act(() => host.querySelector('[role=link]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).toHaveBeenCalledTimes(2);
  });
  it.each(['checkbox', 'switch', 'radio', 'toggle'] as const)('exports an operable %s and updates its bound visibility', kind => {
    const change = vi.fn(); mount(booleanControl(kind), { onValueChange: change });
    const button = host.querySelector('button')!; expect(host.querySelector('[data-name="Mark"]')).toBeNull(); click(button);
    expect(button.getAttribute(kind === 'toggle' ? 'aria-pressed' : 'aria-checked')).toBe('true'); expect(host.querySelector('[data-name="Mark"]')).not.toBeNull(); expect(change).toHaveBeenCalledWith(expect.any(String), true);
    click(button); expect(button.getAttribute(kind === 'toggle' ? 'aria-pressed' : 'aria-checked')).toBe(String(kind === 'radio'));
  });
  it.each(['textField', 'textarea', 'numberField'] as const)('exports editable %s with Unicode and numeric bindings', kind => {
    const owner = main('Input'), text = editor.graph.createNode('TEXT', owner.id, { text: 'Hello', width: 160, height: 30 });
    const id = createComponentProperty(editor, owner, 'Text', 'TEXT', 'Hello'); bindComponentProperty(editor, text, 'TEXT', id);
    setComponentBehaviour(editor, owner, { kind, values: { [kind === 'numberField' ? 'text' : 'value']: 'Text' }, numbers: kind === 'numberField' ? { value: { min: 0, max: 20, step: 2, default: 12 } } : undefined });
    const change = vi.fn(); mount(owner, { onValueChange: change }); const field = host.querySelector('input,textarea') as HTMLInputElement;
    input(field, kind === 'numberField' ? '13' : '你好 👩🏽‍🎨 مرحبا'); expect(field.value).toBe(kind === 'numberField' ? '14' : '你好 👩🏽‍🎨 مرحبا'); expect(change).toHaveBeenCalled();
  });
  it('keeps a field editable when its bound value layer is hidden by the empty state', () => {
    const owner = main('Empty field'), container = editor.graph.createNode('FRAME', owner.id, { x: 12, y: 8, width: 170, height: 40, visible: false });
    const text = editor.graph.createNode('TEXT', container.id, { x: 4, y: 3, width: 160, height: 30, text: '' });
    const value = createComponentProperty(editor, owner, 'Value', 'TEXT', ''); bindComponentProperty(editor, text, 'TEXT', value);
    const filled = createComponentProperty(editor, owner, 'Filled', 'BOOLEAN', 'false'); bindComponentProperty(editor, container, 'VISIBLE', filled);
    setComponentBehaviour(editor, owner, { kind: 'textField', values: { value: 'Value', filled: 'Filled' } });
    mount(owner); const field = host.querySelector('input')!; expect(field).not.toBeNull(); expect(field.style.left).toBe('16px'); expect(field.style.top).toBe('11px');
    input(field, 'Ready 👩🏽‍🎨'); expect(field.value).toBe('Ready 👩🏽‍🎨'); expect(host.textContent).toContain('Ready 👩🏽‍🎨');
    input(field, ''); expect(host.querySelector('input')).toBe(field); expect(host.textContent).toBe('');
  });
  it('preserves mixed UTF-16 typography, language, decorations and active color variables', () => {
    const graph = editor.graph, text = graph.createNode('TEXT', editor.state.currentPageId, { name: 'Mixed type', text: 'A👩🏽‍🎨مرحبا', width: 180, height: 40,
      fontFamily: 'Inter', fontFeatures: [{ tag: 'liga', enabled: false }], fontVariations: [{ axis: 'wght', value: 450 }], textDirection: 'RTL', textLanguage: 'ar',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }],
      styleRuns: [{ start: 1, length: 7, style: { fontWeight: 700, italic: true } }, { start: 8, length: 5, style: { fontFamily: 'Arabic', textLanguage: 'ar', textDecoration: 'UNDERLINE', textDecorationStyle: 'WAVY', textDecorationThickness: 2, textUnderlineOffset: 3 } }] });
    const collection = graph.createCollection('Theme'), color = graph.createVariable('Ink', 'COLOR', collection.id, { r: 0, g: .5, b: 1, a: 1 }); graph.bindVariable(text.id, 'fills/0/color', color.id);
    mount(text); const parent = host.querySelector('[data-name="Mixed type"]') as HTMLElement, spans = parent.querySelectorAll('span');
    expect(parent.textContent).toBe(text.text); expect(parent.style.color).toBe('rgb(0, 128, 255)'); expect(parent.style.direction).toBe('rtl'); expect(parent.lang).toBe('ar');
    expect(parent.style.fontVariationSettings).toBe('"wght" 450'); expect(parent.style.fontFeatureSettings).toBe('"liga" 0');
    expect(spans[1]!.textContent).toBe('👩🏽‍🎨'); expect(spans[1]!.style.fontWeight).toBe('700'); expect(spans[2]!.style.textDecorationStyle).toBe('wavy'); expect(spans[2]!.style.textUnderlineOffset).toBe('3px');
  });
  it('exports actual state variants, escaping names and blocking disabled actions', () => {
    const graph = editor.graph, set = graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Button "<script> &' }); editor.addPropertyDefinition(set.id, 'State', 'VARIANT', 'Default');
    for (const [index, state] of ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'].entries()) graph.createNode('COMPONENT', set.id, { name: state, width: 40 + index, height: 20, componentPropertyValues: { State: state } });
    setComponentBehaviour(editor, set, { kind: 'button', states: 'State' }); const action = vi.fn(), exported = mount(set, { onAction: action });
    const button = host.querySelector('button')!; click(button); expect(action).toHaveBeenCalledTimes(1);
    act(() => button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))); expect(button.firstElementChild?.getAttribute('data-name')).toBe('Hover');
    act(() => root.render(React.createElement(exported.component, { disabled: true, onAction: action }))); click(button); expect(action).toHaveBeenCalledTimes(1); expect(button.firstElementChild?.getAttribute('data-name')).toBe('Disabled');
    expect(exported.code).not.toContain('@open-pencil'); expect(exported.code).not.toContain('<script>');
  });
  it('keeps all live variants when exporting one main component and produces stable control identities',()=>{
    const graph=editor.graph,set=graph.createNode('COMPONENT_SET',editor.state.currentPageId,{name:'Button'});editor.addPropertyDefinition(set.id,'State','VARIANT','Default');
    const source=graph.createNode('COMPONENT',set.id,{name:'Default',componentPropertyValues:{State:'Default'},width:40,height:20});graph.createNode('COMPONENT',set.id,{name:'Hover',componentPropertyValues:{State:'Hover'},width:40,height:20});setComponentBehaviour(editor,set,{kind:'button',states:'State'});
    const first=selectionToReact(graph,[source.id]),second=selectionToReact(graph,[source.id]);expect(first.code).toBe(second.code);
    mount(source);const button=host.querySelector('button')!;act(()=>button.dispatchEvent(new MouseEvent('pointerover',{bubbles:true})));expect(button.firstElementChild?.getAttribute('data-name')).toBe('Hover');
    expect(first.code).toContain('"Hover"');
  });
  it.each(['slider', 'progress'] as const)('exports %s range semantics and positioned artwork', kind => {
    const owner = main(kind); slot(owner, 'Track'); slot(owner, kind === 'slider' ? 'Thumb' : 'Indicator', kind === 'slider' ? 20 : 200);
    setComponentBehaviour(editor, owner, { kind, parts: kind === 'slider' ? { track: 'Track', thumb: 'Thumb' } : { track: 'Track', indicator: 'Indicator' }, numbers: { value: { min: 0, max: 100, step: 10, default: 50 } } });
    mount(owner); if (kind === 'slider') { const range = host.querySelector('input')!; input(range, '100'); expect((host.querySelector('[data-name="Thumb"]') as HTMLElement).style.left).toBe('180px'); }
    else { expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50'); expect((host.querySelector('[data-name="Indicator"]') as HTMLElement).style.width).toBe('100px'); }
  });
  it.each(['radioGroup', 'toggleGroup'] as const)('exports %s item selection and keyboard navigation', kind => {
    const item = booleanControl(kind === 'radioGroup' ? 'radio' : 'toggle'), owner = main(kind), items = slot(owner, 'Items');
    editor.graph.createInstance(item.id, items.id); editor.graph.createInstance(item.id, items.id, { x: 80 }); setComponentBehaviour(editor, owner, { kind, parts: { items: 'Items' } }); mount(owner);
    let buttons = host.querySelectorAll('button'); click(buttons[1]!); expect(buttons[1]!.getAttribute(kind === 'radioGroup' ? 'aria-checked' : 'aria-pressed')).toBe('true');
    if (kind === 'radioGroup') { act(() => { buttons[1]!.focus(); buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); }); buttons = host.querySelectorAll('button'); expect(document.activeElement).toBe(buttons[0]); expect(buttons[0]!.getAttribute('aria-checked')).toBe('true'); expect(buttons[1]!.getAttribute('aria-checked')).toBe('false'); }
    else { click(buttons[0]!); expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true'); }
  });
  it.each(['collapsible', 'accordion'] as const)('exports expandable %s panels', kind => {
    const item = main('Disclosure'); slot(item, 'Trigger'); const content = slot(item, 'Content'); editor.graph.createNode('TEXT', content.id, { text: 'Details' }); setComponentBehaviour(editor, item, { kind: 'collapsible', parts: { trigger: 'Trigger', content: 'Content' } });
    let owner = item; if (kind === 'accordion') { owner = main('Accordion'); const items = slot(owner, 'Items'); editor.graph.createInstance(item.id, items.id); editor.graph.createInstance(item.id, items.id); setComponentBehaviour(editor, owner, { kind, parts: { items: 'Items' } }); }
    mount(owner); expect(host.textContent).not.toContain('Details'); const button = host.querySelector('button')!; click(button); expect(button.getAttribute('aria-expanded')).toBe('true'); expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull(); expect(host.textContent).toContain('Details');
  });
  it('exports tabs with roving focus, linked panels and embedded SVG images', () => {
    const owner = main('Tabs'), list = slot(owner, 'List'), panels = slot(owner, 'Panels');
    for (const name of ['First', 'Second']) { editor.graph.createNode('TEXT', list.id, { name, text: name }); editor.graph.createNode('TEXT', panels.id, { name: `${name} panel`, text: `${name} content` }); }
    setComponentBehaviour(editor, owner, { kind: 'tabs', parts: { list: 'List', panels: 'Panels' } }); mount(owner);
    const tabs = host.querySelectorAll('[role="tab"]'); expect(tabs[0]!.getAttribute('tabindex')).toBe('0');
    act(() => { (tabs[0] as HTMLElement).focus(); tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    expect(document.activeElement).toBe(tabs[1]); expect(tabs[1]!.getAttribute('aria-selected')).toBe('true'); expect(host.querySelectorAll('[role="tabpanel"]')[0]).toHaveProperty('hidden', true);
  });
  it('retains configured component artwork inside tabs without nesting native buttons', () => {
    const item = booleanControl('toggle'), owner = main('Tabs'), list = slot(owner, 'List'), panels = slot(owner, 'Panels');
    editor.graph.createNode('TEXT', item.id, { text: 'Item label', width: 100, height: 20 });
    editor.graph.createInstance(item.id, list.id); editor.graph.createInstance(item.id, list.id, { x: 80 });
    for (let index = 0; index < 2; index++) editor.graph.createNode('TEXT', panels.id, { text: `Panel ${index}` });
    setComponentBehaviour(editor, owner, { kind: 'tabs', parts: { list: 'List', panels: 'Panels' } }); mount(owner);
    const tabs = host.querySelectorAll('[role="tab"]'); expect(tabs).toHaveLength(2); expect(tabs[0]!.textContent).toBe('Item label'); expect(tabs[0]!.querySelector('[data-name="Mark"]')).not.toBeNull();
    expect(tabs[0]!.querySelector('button')).toBeNull(); click(tabs[1]!); expect(tabs[1]!.querySelector('[data-name="Mark"]')).not.toBeNull(); expect(tabs[0]!.querySelector('[data-name="Mark"]')).toBeNull();
  });
  it('honors controlled values, disabled items and instance-owned slots without editing the source', () => {
    const owner = booleanControl('checkbox'), instance = editor.graph.createInstance(owner.id, editor.state.currentPageId)!;
    const change = vi.fn(), exported = mount(instance, { values: { [instance.id]: true }, onValueChange: change }); const button = host.querySelector('button')!;
    click(button); expect(change).toHaveBeenCalledWith(instance.id, false); expect(button.getAttribute('aria-checked')).toBe('true');
    act(() => root.render(React.createElement(exported.component, { values: { [instance.id]: false }, disabled: true, onValueChange: change }))); click(button); expect(change).toHaveBeenCalledTimes(1);
    const empty = main('Incomplete'); setComponentBehaviour(editor, empty, { kind: 'slider' }); expect(() => selectionToReact(editor.graph, [empty.id])).toThrow('bindings');
  });
  it('clones a small dependency closure from a large document and undoes behavior without a document checkpoint', () => {
    const owner = main('Small'); for (let index = 0; index < 10_001; index++) editor.graph.createNode('RECTANGLE', editor.state.currentPageId);
    const untouched = editor.graph.getChildren(editor.state.currentPageId).at(-1)!, pluginData = owner.pluginData;
    setComponentBehaviour(editor, owner, { kind: 'button' }); const clone = cloneReactExportGraph(editor.graph, [owner.id]); expect(clone.nodes.size).toBeLessThan(10); expect(clone.getNode(untouched.id)).toBeUndefined();
    editor.undoAction(); expect(owner.pluginData).toEqual(pluginData); expect(editor.graph.getNode(untouched.id)).toBe(untouched); editor.redoAction(); expect(selectionToReact(editor.graph, [owner.id]).code).toContain('"button"');
  });
  it('preserves separate selected-layer positions, avoids duplicate descendants and exports flips once', () => {
    const first = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'First', x: 150, y: 10, width: 100, height: 40, flipX: true });
    const child = editor.graph.createNode('TEXT', first.id, { name: 'Child', text: 'Child', width: 50, height: 20 });
    const second = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Second', x: 50, y: 40, width: 80, height: 60 });
    const before = serializeGraph(editor.graph), { code } = selectionToReact(editor.graph, [first.id, child.id, second.id]);
    const nodes = JSON.parse(code.split('const design: DesignNode[] = ')[1]!.split(';\n\nexport default')[0]!);
    expect(nodes).toHaveLength(2); expect(nodes[0].style).toMatchObject({ left: 200, top: 0, transform: 'matrix(-1,0,0,1,0,0)' }); expect(nodes[1].style).toMatchObject({ left: 0, top: 30 });
    expect(code).toContain('width={200} height={90}');
    expect(serializeGraph(editor.graph)).toBe(before);
  });
});

it('delivers timed and key interactions from the exact standalone module with React as its only dependency', () => {
  vi.useFakeTimers();
  try {
    const owner = booleanControl('checkbox'), target = editor.graph.createNode('FRAME', editor.state.currentPageId), navigate = vi.fn(), change = vi.fn();
    const navigation = { action: 'navigate' as const, target: target.id, transition: 'slide' as const, direction: 'left' as const, duration: 250, easing: 'linear' as const };
    setPrototypeInteractions(editor, owner, [{ id: 'key', trigger: { type: 'key', keyCodes: [65] }, navigation }, { id: 'delay', trigger: { type: 'delay', delay: 100 }, navigation }]);
    const exported = mount(owner, { onNavigate: navigate, onValueChange: change });
    act(() => host.querySelector('[data-xdesign-view]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }))); expect(navigate).toHaveBeenCalledWith(navigation, owner.id, { type: 'key', keyCodes: [65] });
    act(() => (host.querySelector('button') as HTMLElement).click()); expect(change).toHaveBeenCalledWith(owner.id, true);
    act(() => vi.advanceTimersByTime(100)); expect(navigate).toHaveBeenCalledTimes(2); expect(navigate.mock.calls[1]![2]).toEqual({ type: 'delay', delay: 100 });
    act(() => root.render(React.createElement(exported.component, { onNavigate: navigate, automatic: false }))); act(() => root.render(React.createElement(exported.component, { onNavigate: navigate, automatic: true }))); act(() => vi.advanceTimersByTime(200)); expect(navigate).toHaveBeenCalledTimes(2);
    act(() => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('executes physical spring scrolling from the exact standalone module with only React dependencies', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'), graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), trigger = graph.createNode('TEXT', frame.id, { name: 'Spring link', text: 'Scroll' }), target = graph.createNode('TEXT', frame.id, { name: 'Spring destination', text: 'Footer', y: 900 });
  const easing: DesignSpring = { type: 'spring', mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 }, duration = designSpringDuration(easing), callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false })); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockReturnValue(0);
  setPrototypeScroll(editor, frame, { axis: 'vertical' }); setNavigation(editor, trigger, { action: 'scroll', target: target.id, transition: 'scroll', duration: 1, easing }); mount(frame);
  const viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!, destination = host.querySelector<HTMLElement>('[data-name="Spring destination"]')!; Object.defineProperties(viewport, { clientHeight: { value: 480 }, scrollHeight: { value: 1200 } }); Object.assign(destination, { scrollIntoView: () => { viewport.scrollTop = 200; } });
  const tick = async (time: number) => { const [id, callback] = callbacks.entries().next().value!; callbacks.delete(id); await act(async () => callback(time)); };
  click(host.querySelector('[data-name="Spring link"]')!); await tick(400); expect(viewport.scrollTop).toBeGreaterThan(220); await tick(duration); expect(viewport.scrollTop).toBe(200); expect(callbacks.size).toBe(0); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('plays descendant Scroll To from the exact portable module, with stable target mapping and no navigation host', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll'); const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Scroll export', width: 320, height: 480 }), trigger = graph.createNode('TEXT', frame.id, { name: 'Scroll link', text: 'Scroll' }), target = graph.createNode('TEXT', frame.id, { name: 'Destination', text: 'Footer', y: 900 });
  setPrototypeScroll(editor, frame, { axis: 'vertical', initial: { x: 0, y: 20 } }); setScrollBehaviour(editor, trigger, 'fixed'); setNavigation(editor, trigger, { action: 'scroll', target: target.id, transition: 'instant', duration: 0, offset: { x: 0, y: -10 } }); const exported = mount(frame); const viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!, destination = host.querySelector<HTMLElement>('[data-name=Destination]')!;
  Object.defineProperties(viewport, { clientHeight: { value: 480 }, scrollHeight: { value: 1200 } }); Object.assign(destination, { scrollIntoView: () => { viewport.scrollTop = 500; } }); click(host.querySelector('[data-name="Scroll link"]')!); expect(viewport.scrollTop).toBe(490); expect(host.querySelector('[role=alert]')).toBeNull(); expect(exported.code).toContain(`"target": "${frame.id}/1"`); expect(host.querySelector('[data-xdesign-fixed]')).not.toBeNull();
  expect(() => selectionToReact(graph, [trigger.id])).toThrow('scroll destination');
});
it('runs an ordered local sequence in the exact delivered React module and waits for an asynchronous host', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll'), graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Sequence export', width: 320, height: 480 }), trigger = graph.createNode('RECTANGLE', frame.id, { name: 'Run sequence' }), first = graph.createNode('RECTANGLE', frame.id, { name: 'First destination' }), second = graph.createNode('RECTANGLE', frame.id, { name: 'Second destination' });
  setPrototypeScroll(editor, frame, { axis: 'vertical' }); setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'scroll', target: first.id, transition: 'instant', duration: 0 }, { action: 'scroll', target: second.id, transition: 'instant', duration: 0 }] });
  const exported = mount(frame), viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!, calls: string[] = []; Object.defineProperties(viewport, { clientHeight: { value: 480 }, scrollHeight: { value: 1200 } });
  for (const [name, position] of [['First destination', 200], ['Second destination', 500]] as const) Object.assign(host.querySelector(`[data-name="${name}"]`)!, { scrollIntoView: () => { calls.push(name); viewport.scrollTop = position; } });
  await act(async () => click(host.querySelector('[data-name="Run sequence"]')!)); expect(calls).toEqual(['First destination', 'Second destination']); expect(viewport.scrollTop).toBe(500); expect(exported.code).toContain(`"target": "${frame.id}/2"`);
  act(() => root.render(null)); setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'back', transition: 'instant', duration: 0 }, { action: 'overlay', target: frame.id, transition: 'instant', duration: 0 }] });
  let finish!: (value: boolean) => void; const pending = new Promise<boolean>(resolve => { finish = resolve; }), navigate = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(true); mount(frame, { onNavigate: navigate });
  await act(async () => click(host.querySelector('[data-name="Run sequence"]')!)); expect(navigate).toHaveBeenCalledOnce(); await act(async () => finish(true)); expect(navigate.mock.calls.map(call => call[0].action)).toEqual(['back', 'overlay']); expect(host.querySelector('[role=alert]')).toBeNull();
});

it('preserves managed tabs, scrolling panels and group selection inside configured scrollers', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll');
  const owner = main('Scrollable tabs'), list = slot(owner, 'List'), panels = slot(owner, 'Panels');
  for (const name of ['First', 'Second']) { editor.graph.createNode('TEXT', list.id, { text: name, name }); const panel = editor.graph.createNode('FRAME', panels.id, { name: `${name} panel` }); editor.graph.createNode('TEXT', panel.id, { text: `${name} content` }); }
  setPrototypeScroll(editor, list, { axis: 'horizontal' }); setPrototypeScroll(editor, panels, { axis: 'vertical' }); setComponentBehaviour(editor, owner, { kind: 'tabs', parts: { list: 'List', panels: 'Panels' } }); mount(owner);
  const tablist = host.querySelector('[role=tablist]')!; expect(tablist.querySelector('[data-xdesign-scroll-axis=horizontal]')).not.toBeNull(); expect(host.querySelector('[data-xdesign-scroll-axis=vertical] [role=tabpanel]')).not.toBeNull(); const tabs = host.querySelectorAll('[role=tab]'); act(() => { (tabs[0] as HTMLElement).focus(); tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); }); expect(tabs[1]!.getAttribute('aria-selected')).toBe('true'); expect(host.querySelectorAll<HTMLElement>('[role=tabpanel]')[0]!.hidden).toBe(true);
  const item = booleanControl('radio'), group = main('Scrollable group'), items = slot(group, 'Items'); editor.graph.createInstance(item.id, items.id); editor.graph.createInstance(item.id, items.id, { x: 80 }); setPrototypeScroll(editor, items, { axis: 'horizontal' }); setComponentBehaviour(editor, group, { kind: 'radioGroup', parts: { items: 'Items' } }); mount(group); const scroller = host.querySelector('[data-xdesign-scroll]')!; expect(scroller.querySelectorAll('[role=radio]')).toHaveLength(2); click(scroller.querySelectorAll('[role=radio]')[1]!); expect(scroller.querySelectorAll('[role=radio]')[1]!.getAttribute('aria-checked')).toBe('true');
});

it('executes the delivered variable/mode/conditional module locally and commits live bindings before asynchronous host navigation', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), run = graph.createNode('TEXT', frame.id, { name: 'Variable run', text: 'Run', width: 100, height: 20 }), mark = graph.createNode('RECTANGLE', frame.id, { name: 'Variable mark', width: 40, height: 40, visible: false, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
  const collection = graph.createCollection('Theme'), dark = crypto.randomUUID(); graph.addMode(collection.id, dark, 'Dark'); const shown = graph.createVariable('Shown', 'BOOLEAN', collection.id, false), color = graph.createVariable('Color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); editor.updateVariableValue(color.id, dark, { r: 0, g: 0, b: 1, a: 1 }); graph.bindVariable(mark.id, 'visible', shown.id); graph.bindVariable(mark.id, 'fills/0/color', color.id);
  const instant = { transition: 'instant' as const, duration: 0 }; setPrototypeInteractions(editor, run, [{ id: 'run', trigger: { type: 'click' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'set-mode', collection: collection.id, mode: dark }, { ...instant, action: 'set-variable', variable: shown.id, value: { type: 'literal', value: true } }, { ...instant, action: 'conditional', branches: [{ condition: { type: 'variable', id: shown.id }, actions: [{ ...instant, action: 'back' }] }, { actions: [{ ...instant, action: 'close' }] }] }] } }]);
  const navigate = vi.fn(async (action: unknown) => { expect(host.querySelector<HTMLElement>('[data-name="Variable mark"]')!.style.backgroundColor).toBe('rgb(0, 0, 255)'); return action; }), before = serializeGraph(graph), result = mount(frame, { onNavigate: navigate }); expect(host.querySelector('[data-name="Variable mark"]')).toBeNull(); await act(async () => click(host.querySelector('[data-name="Variable run"]')!)); expect(navigate.mock.calls.map(call => (call[0] as { action: string }).action)).toEqual(['back']); expect(serializeGraph(graph)).toBe(before); expect(result.code).not.toContain("from './prototypeValues'");
});
it('resizes the portable view for a bound root frame and refuses changing artwork it cannot regenerate faithfully', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), run = graph.createNode('TEXT', frame.id, { name: 'Resize', text: 'Resize', width: 100, height: 20 }), collection = graph.createCollection('Size'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(frame.id, 'width', width.id);
  setPrototypeInteractions(editor, run, [{ id: 'resize', trigger: { type: 'click' }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 500 }, transition: 'instant', duration: 0 } }]); mount(frame); await act(async () => click(host.querySelector('[data-name=Resize]')!)); expect(host.querySelector<HTMLElement>('[data-xdesign-view]')!.style.width).toBe('500px');
  const painted = graph.createNode('RECTANGLE', frame.id, { name: 'Painted', fills: [{ type: 'SOLID', visible: true, opacity: .5, color: { r: 1, g: 0, b: 0, a: 1 } }] }), color = graph.createVariable('Paint', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); graph.bindVariable(painted.id, 'fills/0/color', color.id); expect(() => selectionToReact(graph, [frame.id])).toThrow('cannot update faithfully');
});
it('reflows exported MIN, MAX, CENTER, STRETCH and SCALE layers from pinned geometry, including nested and explicit bindings', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80 }), run = graph.createNode('TEXT', frame.id, { name: 'Resize constraints', text: 'Resize', width: 100, height: 20 }), shrink = graph.createNode('TEXT', frame.id, { name: 'Shrink constraints', text: 'Shrink', x: 0, y: 24, width: 100, height: 20 });
  const collection = graph.createCollection('Responsive'), width = graph.createVariable('Width', 'FLOAT', collection.id, 150), height = graph.createVariable('Height', 'FLOAT', collection.id, 90), explicitWidth = graph.createVariable('Explicit width', 'FLOAT', collection.id, 25);
  graph.bindVariable(frame.id, 'width', width.id); graph.bindVariable(frame.id, 'height', height.id);
  const modes = ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] as const;
  for (const [index, constraint] of modes.entries()) graph.createNode('RECTANGLE', frame.id, { name: `Axis ${constraint}`, x: 10, y: 8, width: 20, height: 12, horizontalConstraint: constraint, verticalConstraint: constraint, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: index / 5, b: 0, a: 1 } }] });
  const nested = graph.createNode('FRAME', frame.id, { name: 'Nested stretch', x: 10, y: 10, width: 50, height: 40, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH' });
  graph.createNode('RECTANGLE', nested.id, { name: 'Nested max', x: 30, y: 5, width: 10, height: 10, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] });
  const group = graph.createNode('GROUP', frame.id, { name: 'Scaled group', x: 10, y: 10, width: 50, height: 40, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH' });
  graph.createNode('RECTANGLE', group.id, { name: 'Scaled group child', x: 10, y: 5, width: 20, height: 10, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 0, a: 1 } }] });
  const zeroGroup = graph.createNode('GROUP', frame.id, { name: 'Zero-axis group', x: 0, y: 0, width: 0, height: 20, horizontalConstraint: 'STRETCH', verticalConstraint: 'MIN' });
  graph.createNode('RECTANGLE', zeroGroup.id, { name: 'Zero-axis child', x: 5, y: 3, width: 10, height: 8 });
  graph.createNode('TEXT', frame.id, { name: 'Live constrained text', text: 'Responsive text remains live', x: 10, y: 44, width: 20, height: 12, horizontalConstraint: 'STRETCH' });
  const anchor = graph.createNode('RECTANGLE', frame.id, { name: 'Position-only stroked artwork', x: 20, y: 70, width: 14, height: 8, horizontalConstraint: 'MAX', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  anchor.strokes = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'CENTER' }];
  const explicit = graph.createNode('RECTANGLE', frame.id, { name: 'Explicit width', x: 10, y: 60, width: 20, height: 10, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }] }); graph.bindVariable(explicit.id, 'width', explicitWidth.id);
  const setSize = (nextWidth: number, nextHeight: number) => ({ action: 'sequence' as const, transition: 'instant' as const, duration: 0, actions: [{ action: 'set-variable' as const, variable: width.id, value: { type: 'literal' as const, value: nextWidth }, transition: 'instant' as const, duration: 0 }, { action: 'set-variable' as const, variable: height.id, value: { type: 'literal' as const, value: nextHeight }, transition: 'instant' as const, duration: 0 }] });
  setPrototypeInteractions(editor, run, [{ id: 'grow', trigger: { type: 'click' }, navigation: setSize(200, 120) }]); setPrototypeInteractions(editor, shrink, [{ id: 'shrink', trigger: { type: 'click' }, navigation: setSize(60, 40) }]);
  const before = serializeGraph(graph); mount(frame);
  const px = (name: string, property: 'left' | 'top' | 'width' | 'height') => Number.parseFloat(String(host.querySelector<HTMLElement>(`[data-name="${name}"]`)!.style[property] ?? '0'));
  const artworkImage = host.querySelector<HTMLElement>('[data-name="Position-only stroked artwork"] img') as HTMLImageElement;
  expect(artworkImage?.src).toMatch(/^data:image\/svg\+xml/);
  const assertGeometry = (nextWidth: number, nextHeight: number) => {
    for (const [index, constraint] of modes.entries()) {
      const expected = constrainedChildRect({ x: 10, y: 8, width: 20, height: 12 }, { width: 100, height: 80 }, { width: nextWidth, height: nextHeight }, constraint, constraint), name = `Axis ${constraint}`;
      expect([px(name, 'left'), px(name, 'top'), px(name, 'width'), px(name, 'height')], `${constraint} #${index}`).toEqual([expected.x, expected.y, expected.width, expected.height]);
      expect(host.querySelector<HTMLElement>(`[data-name="${name}"]`)!.style.backgroundColor).not.toBe('');
    }
    const nestedRect = constrainedChildRect({ x: 10, y: 10, width: 50, height: 40 }, { width: 100, height: 80 }, { width: nextWidth, height: nextHeight }, 'STRETCH', 'STRETCH');
    expect([px('Nested stretch', 'left'), px('Nested stretch', 'width')]).toEqual([nestedRect.x, nestedRect.width]);
    const innerRect = constrainedChildRect({ x: 30, y: 5, width: 10, height: 10 }, { width: 50, height: 40 }, { width: nestedRect.width, height: nestedRect.height }, 'MAX', 'MAX');
    expect([px('Nested max', 'left'), px('Nested max', 'top'), px('Nested max', 'width'), px('Nested max', 'height')]).toEqual([innerRect.x, innerRect.y, innerRect.width, innerRect.height]);
    const groupRect = constrainedChildRect({ x: 10, y: 10, width: 50, height: 40 }, { width: 100, height: 80 }, { width: nextWidth, height: nextHeight }, 'STRETCH', 'STRETCH');
    const groupChild = scaledChildRect({ x: 10, y: 5, width: 20, height: 10 }, { width: 50, height: 40 }, { width: groupRect.width, height: groupRect.height });
    expect([px('Scaled group child', 'left'), px('Scaled group child', 'top'), px('Scaled group child', 'width'), px('Scaled group child', 'height')]).toEqual([groupChild.x, groupChild.y, groupChild.width, groupChild.height]);
    const zeroParent = constrainedChildRect({ x: 0, y: 0, width: 0, height: 20 }, { width: 100, height: 80 }, { width: nextWidth, height: nextHeight }, 'STRETCH', 'MIN');
    const zeroChild = scaledChildRect({ x: 5, y: 3, width: 10, height: 8 }, { width: 0, height: 20 }, { width: zeroParent.width, height: zeroParent.height });
    expect([px('Zero-axis group', 'width'), px('Zero-axis child', 'left'), px('Zero-axis child', 'width')]).toEqual([zeroParent.width, zeroChild.x, zeroChild.width]);
    const textRect = constrainedChildRect({ x: 10, y: 44, width: 20, height: 12 }, { width: 100, height: 80 }, { width: nextWidth, height: nextHeight }, 'STRETCH', 'MIN');
    expect([px('Live constrained text', 'left'), px('Live constrained text', 'width')]).toEqual([textRect.x, textRect.width]);
    expect(px('Position-only stroked artwork', 'left')).toBe(20 + nextWidth - 100); expect(host.querySelector('[data-name="Position-only stroked artwork"] img')).not.toBeNull();
    expect([px('Explicit width', 'left'), px('Explicit width', 'width')]).toEqual([10, 25]);
  };
  assertGeometry(150, 90); await act(async () => click(host.querySelector('[data-name="Shrink constraints"]')!)); assertGeometry(60, 40);
  await act(async () => click(host.querySelector('[data-name="Resize constraints"]')!)); assertGeometry(200, 120); expect(serializeGraph(graph)).toBe(before);
});
it('keeps portable rotated and reflected bound-size corners at the live center in the generated module', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 200, height: 120, fills: [] });
  const trigger = graph.createNode('TEXT', frame.id, { name: 'Resize bound pivots', text: 'Resize', width: 80, height: 12 });
  const collection = graph.createCollection('Live pivot'), width = graph.createVariable('Width', 'FLOAT', collection.id, 45), height = graph.createVariable('Height', 'FLOAT', collection.id, 25);
  const text = graph.createNode('TEXT', frame.id, { name: 'Bound reflected text', text: 'Live text', x: 12, y: 30, width: 20, height: 10, rotation: 31, flipX: true });
  const nested = graph.createNode('FRAME', frame.id, { name: 'Bound reflected frame', x: 90, y: 50, width: 20, height: 10, rotation: -24, flipY: true, fills: [] });
  for (const node of [text, nested]) { graph.bindVariable(node.id, 'width', width.id); graph.bindVariable(node.id, 'height', height.id); }
  setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 82 }, transition: 'instant', duration: 0 }, { action: 'set-variable', variable: height.id, value: { type: 'literal', value: 47 }, transition: 'instant', duration: 0 }] });
  const before = serializeGraph(graph), independent = cloneReactExportGraph(graph, [frame.id]); mount(frame);
  const assertSize = (nextWidth: number, nextHeight: number) => {
    for (const source of [text, nested]) { const expected = independent.getNode(source.id)!; Object.assign(expected, { width: nextWidth, height: nextHeight }); expectLocalCorners(host.querySelector<HTMLElement>(`[data-name="${source.name}"]`)!, expected); }
  };
  assertSize(45, 25); await act(async () => click(host.querySelector('[data-name="Resize bound pivots"]')!)); assertSize(82, 47); expect(serializeGraph(graph)).toBe(before);
});
it('keeps nested STRETCH and fixed-video pivots live at two sizes without remounting playback', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll');
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80, fills: [] }); setPrototypeScroll(editor, frame, { axis: 'vertical' });
  const trigger = graph.createNode('TEXT', frame.id, { name: 'Resize stretched pivots', text: 'Resize', width: 80, height: 12 });
  const collection = graph.createCollection('Stretch pivots'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100), height = graph.createVariable('Height', 'FLOAT', collection.id, 80); graph.bindVariable(frame.id, 'width', width.id); graph.bindVariable(frame.id, 'height', height.id);
  const nested = graph.createNode('FRAME', frame.id, { name: 'Stretched reflected frame', x: 10, y: 12, width: 60, height: 40, rotation: 17, flipX: true, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [] }); setPrototypeScroll(editor, nested, { axis: 'vertical' }); setScrollBehaviour(editor, nested, 'fixed');
  const text = graph.createNode('TEXT', nested.id, { name: 'Stretched reflected text', text: 'Nested', x: 5, y: 6, width: 20, height: 10, rotation: -31, flipY: true, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH' });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Stretched reflected video', width: 20, height: 20, duration: 3 }, 6, 8, frame.id), video = graph.getNode(videoId)!;
  Object.assign(video, { rotation: 24, flipX: true, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH' }); setScrollBehaviour(editor, video, 'fixed');
  setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 180 }, transition: 'instant', duration: 0 }, { action: 'set-variable', variable: height.id, value: { type: 'literal', value: 140 }, transition: 'instant', duration: 0 }] });
  const before = serializeGraph(graph), independent = cloneReactExportGraph(graph, [frame.id]); mount(frame); const media = host.querySelector('video')!; media.currentTime = 1.5;
  const assertSize = (nextWidth: number, nextHeight: number) => {
    const dx = nextWidth - 100, dy = nextHeight - 80;
    Object.assign(independent.getNode(nested.id)!, { width: 60 + dx, height: 40 + dy }); Object.assign(independent.getNode(text.id)!, { width: 20 + dx, height: 10 + dy }); Object.assign(independent.getNode(video.id)!, { width: 20 + dx, height: 20 + dy });
    for (const source of [nested, text, video]) expectLocalCorners(host.querySelector<HTMLElement>(`[data-name="${source.name}"]`)!, independent.getNode(source.id)!);
    expect(host.querySelector('[data-name="Stretched reflected frame"]')!.closest('[data-xdesign-fixed]')).not.toBeNull(); expect(media.closest('[data-xdesign-fixed]')).not.toBeNull();
  };
  assertSize(100, 80); await act(async () => click(host.querySelector('[data-name="Resize stretched pivots"]')!)); assertSize(180, 140); expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1.5); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(serializeGraph(graph)).toBe(before);
});
it('retains exact legacy LINE, selected-root and native-prepared transform matrices', async () => {
  const { setPrototypeScroll } = await import('./prototypeScroll');
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { x: 70, y: 40, width: 100, height: 80, rotation: 19, flipX: true, fills: [] });
  setPrototypeScroll(editor, frame, { axis: 'vertical' });
  const child = graph.createNode('FRAME', frame.id, { name: 'Prepared reflected child', x: 12, y: 8, width: 20, height: 18, rotation: -27, flipY: true, fills: [] });
  const line = graph.createNode('LINE', frame.id, { name: 'Legacy line pivot', x: 5, y: 6, width: 70, height: 3, rotation: 29, flipX: true, flipY: true, fills: [] });
  const collection = graph.createCollection('Prepared pivot'), width = graph.createVariable('Width', 'FLOAT', collection.id, 37); graph.bindVariable(child.id, 'width', width.id);
  const before = serializeGraph(graph), independent = cloneReactExportGraph(graph, [frame.id]); independent.getNode(child.id)!.width = 37;
  const css = (node: SceneNode) => { const matrix = getNodeLocalMatrix(node, { x: 0, y: 0 }); return `matrix(${matrix[0]},${matrix[3]},${matrix[1]},${matrix[4]},${matrix[2]},${matrix[5]})`; };
  const portable = selectionToDesignModel(graph, [frame.id]), prepared = vi.fn(), native = selectionToDesignModel(graph, [frame.id], undefined, true, undefined, undefined, false, undefined, false, prepared), nativeScene = selectionToDesignModel(graph, [frame.id], undefined, true, undefined, undefined, false, undefined, true);
  expect(prepared).toHaveBeenCalledOnce();
  for (const model of [native, nativeScene]) expect(model.nodes[0]!.children[0]!.style).toMatchObject({ width: 37, transform: css(independent.getNode(child.id)!), transformOrigin: '0 0' });
  for (const model of [portable, native, nativeScene]) {
    expect(model.nodes[0]!.children[1]!.style).toMatchObject({ transform: css(line), transformOrigin: '0 0' });
    const matrix = getWorldMatrix(frame, graph); expect(model.nodes[0]!.style).toMatchObject({ transform: `matrix(${matrix[0]},${matrix[3]},${matrix[1]},${matrix[4]},0,0)`, transformOrigin: '0 0' });
  }
  expect(serializeGraph(graph)).toBe(before);
});
it('refuses responsive resizing of stroked artwork whose exported SVG pixels cannot be regenerated', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80 }), run = graph.createNode('TEXT', frame.id, { name: 'Resize stroked child', text: 'Resize' }), collection = graph.createCollection('Responsive stroke'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100);
  graph.bindVariable(frame.id, 'width', width.id);
  const child = graph.createNode('RECTANGLE', frame.id, { name: 'Stroked child', x: 10, y: 10, width: 30, height: 20, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
  child.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'CENTER' }];
  setPrototypeInteractions(editor, run, [{ id: 'grow', trigger: { type: 'click' }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 200 }, transition: 'instant', duration: 0 } }]);
  expect(() => selectionToReact(graph, [frame.id])).toThrow('Responsive resizing of baked artwork needs source-backed rendering');
});
it('reflows fixed exported layers and controls from live constraints and explicit geometry without resetting scrolling', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll');
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Fixed responsive screen', width: 100, height: 80, fills: [] });
  setPrototypeScroll(editor, frame, { axis: 'vertical', initial: { x: 0, y: 7 } });
  const collection = graph.createCollection('Fixed geometry'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100), height = graph.createVariable('Height', 'FLOAT', collection.id, 80);
  graph.bindVariable(frame.id, 'width', width.id); graph.bindVariable(frame.id, 'height', height.id);
  const modes = ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] as const;
  for (const constraint of modes) {
    const node = graph.createNode('RECTANGLE', frame.id, { name: `Fixed ${constraint}`, x: 10, y: 8, width: 20, height: 12, horizontalConstraint: constraint, verticalConstraint: constraint, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
    setScrollBehaviour(editor, node, 'fixed');
  }
  const explicit = graph.createNode('RECTANGLE', frame.id, { name: 'Fixed explicit geometry', x: 10, y: 8, width: 20, height: 12, horizontalConstraint: 'SCALE', verticalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }] });
  setScrollBehaviour(editor, explicit, 'fixed');
  const bindings = [['x', 10, 22], ['y', 8, 18], ['width', 20, 35], ['height', 12, 16]] as const;
  const variables = bindings.map(([field, initial, next]) => { const variable = graph.createVariable(field, 'FLOAT', collection.id, initial); graph.bindVariable(explicit.id, field, variable.id); return { variable, next }; });
  const nested = graph.createNode('FRAME', frame.id, { name: 'Fixed nested frame', x: 10, y: 10, width: 50, height: 40, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [] });
  setScrollBehaviour(editor, nested, 'fixed'); setPrototypeScroll(editor, nested, { axis: 'vertical', initial: { x: 0, y: 3 } });
  const nestedChild = graph.createNode('RECTANGLE', nested.id, { name: 'Fixed nested max', x: 30, y: 5, width: 10, height: 10, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] });
  setScrollBehaviour(editor, nestedChild, 'fixed');
  const owner = booleanControl('checkbox', 'Fixed checkbox'), control = graph.createInstance(owner.id, frame.id, { x: 4, y: 4 })!;
  updateDesignProperties(editor, control.id, { width: 30, height: 20, horizontalConstraint: 'STRETCH', verticalConstraint: 'MIN' }); setScrollBehaviour(editor, control, 'fixed');
  const trigger = graph.createNode('TEXT', frame.id, { name: 'Update fixed geometry', text: 'Update', y: 200, width: 80, height: 20 });
  const assignments = [{ variable: width, next: 200 }, { variable: height, next: 120 }, ...variables];
  setPrototypeInteractions(editor, trigger, [{ id: 'resize-fixed', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: assignments.map(({ variable, next }) => ({ action: 'set-variable' as const, variable: variable.id, value: { type: 'literal' as const, value: next }, transition: 'instant' as const, duration: 0 })) } }]);
  const before = serializeGraph(graph), change = vi.fn(); mount(frame, { onValueChange: change });
  const viewports = host.querySelectorAll<HTMLElement>('[data-xdesign-scroll]'), outerScroll = viewports[0]!, innerScroll = viewports[1]!;
  outerScroll.scrollTop = 45; innerScroll.scrollTop = 13;
  act(() => { outerScroll.dispatchEvent(new Event('scroll')); innerScroll.dispatchEvent(new Event('scroll')); });
  await act(async () => click(host.querySelector('[data-name="Update fixed geometry"]')!));
  const rect = (name: string) => { const style = host.querySelector<HTMLElement>(`[data-name="${name}"]`)!.style; return [style.left, style.top, style.width, style.height].map(Number.parseFloat); };
  for (const constraint of modes) {
    const expected = constrainedChildRect({ x: 10, y: 8, width: 20, height: 12 }, { width: 100, height: 80 }, { width: 200, height: 120 }, constraint, constraint);
    expect(rect(`Fixed ${constraint}`)).toEqual([expected.x, expected.y, expected.width, expected.height]);
  }
  expect(rect('Fixed explicit geometry')).toEqual([22, 18, 35, 16]);
  expect(rect('Fixed nested frame')).toEqual([10, 10, 150, 80]); expect(rect('Fixed nested max')).toEqual([130, 45, 10, 10]);
  const button = host.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect([button.style.left, button.style.top, button.style.width, button.style.height]).toEqual(['4px', '4px', '130px', '20px']);
  click(button); expect(button.getAttribute('aria-checked')).toBe('true'); expect(change).toHaveBeenCalledWith(expect.any(String), true);
  expect([outerScroll.scrollTop, innerScroll.scrollTop]).toEqual([45, 13]); expect(serializeGraph(graph)).toBe(before);
});

it('keeps fixed exported tabs and panels at live geometry with one placement and operable selection', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll');
  const graph = editor.graph, owner = main('Fixed tabs'), list = slot(owner, 'List', 100), panels = slot(owner, 'Panels', 100);
  Object.assign(list, { height: 30, fills: [] }); Object.assign(panels, { y: 35, height: 40, fills: [] });
  setPrototypeScroll(editor, list, { axis: 'horizontal' }); setPrototypeScroll(editor, panels, { axis: 'vertical' });
  const first = graph.createNode('TEXT', list.id, { name: 'Fixed first tab', text: 'First', x: 5, y: 2, width: 25, height: 12, horizontalConstraint: 'MAX' });
  const second = graph.createNode('TEXT', list.id, { name: 'Fixed second tab', text: 'Second', x: 35, y: 2, width: 25, height: 12 });
  const firstPanel = graph.createNode('FRAME', panels.id, { name: 'Fixed first panel', x: 7, y: 3, width: 70, height: 24, horizontalConstraint: 'STRETCH', fills: [] });
  const secondPanel = graph.createNode('FRAME', panels.id, { name: 'Fixed second panel', x: 9, y: 3, width: 70, height: 24, fills: [] });
  graph.createNode('TEXT', firstPanel.id, { name: 'First panel local text', text: 'First content', x: 4, y: 2, width: 50, height: 12 });
  graph.createNode('TEXT', secondPanel.id, { name: 'Second panel local text', text: 'Second content', x: 4, y: 2, width: 50, height: 12 });
  for (const node of [first, second, firstPanel, secondPanel]) setScrollBehaviour(editor, node, 'fixed');
  const collection = graph.createCollection('Fixed tabs geometry'), width = graph.createVariable('List width', 'FLOAT', collection.id, 100), panelWidth = graph.createVariable('Panel width', 'FLOAT', collection.id, 100), left = graph.createVariable('Panel left', 'FLOAT', collection.id, 7);
  graph.bindVariable(list.id, 'width', width.id); graph.bindVariable(panels.id, 'width', panelWidth.id); graph.bindVariable(firstPanel.id, 'x', left.id);
  const trigger = graph.createNode('TEXT', owner.id, { name: 'Grow fixed tabs', text: 'Grow', y: 80, width: 80, height: 20 });
  const assignments = [[width, 180], [panelWidth, 180], [left, 19]] as const;
  setPrototypeInteractions(editor, trigger, [{ id: 'grow-tabs', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: assignments.map(([variable, value]) => ({ action: 'set-variable' as const, variable: variable.id, value: { type: 'literal' as const, value }, transition: 'instant' as const, duration: 0 })) } }]);
  setComponentBehaviour(editor, owner, { kind: 'tabs', parts: { list: 'List', panels: 'Panels' } });
  const before = serializeGraph(graph); mount(owner);
  const scrolls = host.querySelectorAll<HTMLElement>('[data-xdesign-scroll]'); scrolls[0]!.scrollLeft = 14; scrolls[1]!.scrollTop = 17;
  await act(async () => click(host.querySelector('[data-name="Grow fixed tabs"]')!));
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]'), panel = host.querySelector<HTMLElement>('[role="tabpanel"]')!, content = panel.querySelector<HTMLElement>('[data-name="Fixed first panel"]')!;
  expect([tabs[0]!.style.left, tabs[0]!.style.width]).toEqual(['85px', '25px']);
  expect([panel.style.left, panel.style.top, panel.style.width, panel.style.height]).toEqual(['19px', '3px', '150px', '24px']);
  expect([content.style.left, content.style.top, content.style.width, content.style.height]).toEqual(['0px', '0px', '150px', '24px']);
  expect(panel.querySelector<HTMLElement>('[data-name="First panel local text"]')!.style.left).toBe('4px');
  click(tabs[1]!); expect(tabs[1]!.getAttribute('aria-selected')).toBe('true'); expect(panel.hidden).toBe(true); expect(host.querySelectorAll<HTMLElement>('[role="tabpanel"]')[1]!.hidden).toBe(false);
  expect([scrolls[0]!.scrollLeft, scrolls[1]!.scrollTop]).toEqual([14, 17]); expect(serializeGraph(graph)).toBe(before);
});
it('continues refusing fixed responsive artwork whose baked pixels cannot be regenerated', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll');
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Fixed baked scene', width: 100, height: 80 });
  setPrototypeScroll(editor, frame, { axis: 'vertical' });
  const collection = graph.createCollection('Fixed baked sizing'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100); graph.bindVariable(frame.id, 'width', width.id);
  const child = graph.createNode('RECTANGLE', frame.id, { name: 'Fixed stroked artwork', x: 10, y: 10, width: 30, height: 20, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'CENTER' }] });
  setScrollBehaviour(editor, child, 'fixed');
  const before = serializeGraph(graph);
  expect(() => selectionToReact(graph, [frame.id])).toThrow('Responsive resizing of baked artwork needs source-backed rendering');
  expect(serializeGraph(graph)).toBe(before);
});
it('delivers authored fixed video and nested scroll order from the actual exported module without baking scroll offsets', async () => {
  const { setPrototypeScroll, setScrollBehaviour } = await import('./prototypeScroll');
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Ordered fixed screen', width: 100, height: 80, fills: [], cornerRadius: 8, clipsContent: true });
  setPrototypeScroll(editor, frame, { axis: 'vertical', initial: { x: 0, y: 7 } });
  const trigger = graph.createNode('TEXT', frame.id, { name: 'Scroll nested content', text: 'Scroll', x: 2, y: 2, width: 40, height: 12 });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Ordered live clip', width: 20, height: 20, duration: 3 }, 6, 8, frame.id), videoNode = graph.getNode(videoId)!;
  updateDesignProperties(editor, videoId, { rotation: 24 }); setScrollBehaviour(editor, videoNode, 'fixed');
  const inner = graph.createNode('FRAME', frame.id, { name: 'Ordered fixed inner', x: 10, y: 15, width: 70, height: 50, fills: [] });
  setPrototypeScroll(editor, inner, { axis: 'vertical' }); setScrollBehaviour(editor, inner, 'fixed');
  const fixed = graph.createNode('TEXT', inner.id, { name: 'Ordered inner fixed', text: 'Fixed', x: 4, y: 3, width: 20, height: 12 }); setScrollBehaviour(editor, fixed, 'fixed');
  const destination = graph.createNode('TEXT', inner.id, { name: 'Ordered destination', text: 'Destination', x: 2, y: 200, width: 40, height: 12 });
  graph.createNode('RECTANGLE', frame.id, { name: 'Authored foreground', x: 6, y: 8, width: 30, height: 30, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }] });
  setNavigation(editor, trigger, { action: 'scroll', target: destination.id, transition: 'instant', duration: 0 });
  const before = serializeGraph(graph), exported = mount(frame), viewports = host.querySelectorAll<HTMLElement>('[data-xdesign-scroll]'), outerScroll = viewports[0]!, innerScroll = viewports[1]!;
  Object.defineProperties(outerScroll, { clientHeight: { value: 80 }, scrollHeight: { value: 400 } }); Object.defineProperties(innerScroll, { clientHeight: { value: 50 }, scrollHeight: { value: 400 } });
  const order = [...outerScroll.firstElementChild!.children].map(child => child.getAttribute('data-xdesign-fixed') ?? child.getAttribute('data-xdesign-layer'));
  expect(order).toEqual([`${frame.id}/0`, `${frame.id}/1`, `${frame.id}/2`, `${frame.id}/3`]);
  const video = host.querySelector<HTMLVideoElement>('video')!, videoLayer = host.querySelector<HTMLElement>('[data-name="Ordered live clip"]')!, transform = videoLayer.style.transform, origin = videoLayer.style.transformOrigin;
  const videoClip = video.closest<HTMLElement>('[data-xdesign-fixed]')!, innerClip = host.querySelector<HTMLElement>('[data-name="Ordered fixed inner"]')!.closest<HTMLElement>('[data-xdesign-fixed]')!;
  expect(transform).toMatch(/^matrix\(/); expectLocalCorners(videoLayer, videoNode); video.currentTime = 1.5;
  outerScroll.scrollTop = 30; innerScroll.scrollTop = 20; act(() => { outerScroll.dispatchEvent(new Event('scroll')); innerScroll.dispatchEvent(new Event('scroll')); });
  expect(videoClip.style.transform).toBe('translate(0px,30px)'); expect(innerClip.style.transform).toBe('translate(0px,30px)'); expect(videoClip.style.overflow).toBe('hidden'); expect(videoClip.style.borderRadius).toBe('8px');
  Object.assign(host.querySelector('[data-name="Ordered destination"]')!, { scrollIntoView: () => { innerScroll.scrollTop = 200; outerScroll.scrollTop = 300; host.scrollTop = 500; } });
  click(host.querySelector('[data-name="Scroll nested content"]')!);
  expect([outerScroll.scrollTop, innerScroll.scrollTop, host.scrollTop]).toEqual([30, 200, 0]);
  expect(host.querySelector('[data-name="Ordered inner fixed"]')!.closest<HTMLElement>('[data-xdesign-fixed]')!.style.transform).toBe('translate(0px,200px)');
  act(() => root.render(React.createElement(exported.component, { values: { unrelated: true } })));
  expect(host.querySelector('video')).toBe(video); expect(video.currentTime).toBe(1.5); expect([videoLayer.style.transform, videoLayer.style.transformOrigin]).toEqual([transform, origin]); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(serializeGraph(graph)).toBe(before);
});
it('keeps native prepared bounds authoritative and omits portable responsive/CSS-paint metadata', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80 }), collection = graph.createCollection('Native sizing'), parentWidth = graph.createVariable('Parent width', 'FLOAT', collection.id, 140), childWidth = graph.createVariable('Child width', 'FLOAT', collection.id, 37);
  graph.bindVariable(frame.id, 'width', parentWidth.id);
  const child = graph.createNode('RECTANGLE', frame.id, { name: 'Native explicit child', x: 12, y: 8, width: 20, height: 18, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }); graph.bindVariable(child.id, 'width', childWidth.id);
  const before = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id], undefined, true), exportedChild = model.nodes[0]!.children[0]!;
  expect(model.nodes[0]!.style.width).toBe(140); expect(exportedChild.style.width).toBe(37); expect(exportedChild.responsive).toBeUndefined(); expect(exportedChild.style.backgroundColor).toBeUndefined(); expect(serializeGraph(graph)).toBe(before);
});
it('normalizes selected root positions without applying parent-canvas constraints', () => {
  const graph = editor.graph, first = graph.createNode('FRAME', editor.state.currentPageId, { name: 'First exported root', x: 400, y: 50, width: 100, height: 80 }), second = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Second exported root', x: 550, y: 90, width: 60, height: 40 });
  const model = selectionToDesignModel(graph, [first.id, second.id]);
  expect(model.nodes.map(node => node.style.left)).toEqual([0, 150]); expect(model.nodes.map(node => node.responsive)).toEqual([undefined, undefined]);
});
it('exports measured flex-grown parents with authored fallback and responsive constraints instead of a zero-size placeholder', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Flex root', width: 200, height: 80, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { name: 'Flex-grown parent', width: 60, height: 50, layoutGrow: 1 }); graph.createNode('RECTANGLE', flex.id, { name: 'Constrained flex child', x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'STRETCH' });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), exportedFlex = model.nodes[0]!.children[0]!;
  expect(exportedFlex.id).toBe(`${frame.id}/0`); expect(exportedFlex.name).toBe(flex.name); expect(exportedFlex.style.width).toBe(0); expect(exportedFlex.measuredFrame).toEqual({ width: 200, height: 50 }); expect(exportedFlex.children[0]!.responsive).toMatchObject({ x: 8, y: 6, width: 20, height: 12, parentWidth: 60, parentHeight: 50, horizontal: 'STRETCH' });
  expect(model.prototypeIssues).toEqual([]); expect(selectionToReact(graph, [frame.id]).code).toContain('"measuredFrame"'); expect(serializeGraph(graph)).toBe(source);
});
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(layoutMode => (['AUTO', 'MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'] as const).map(layoutAlignSelf => ({ layoutMode, layoutAlignSelf }))))('matches native leaf cross-axis alignment for measured $layoutMode / $layoutAlignSelf frames', ({ layoutMode, layoutAlignSelf }) => {
  const graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode, counterAxisAlign: 'STRETCH' }), flex = graph.createNode('FRAME', root.id, { width: 80, height: 80, layoutGrow: 1, layoutAlignSelf, minWidth: 40, maxWidth: 400, minHeight: 30, maxHeight: 250 }); graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'MAX', verticalConstraint: 'MAX' });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [root.id]), result = model.nodes[0]!.children[0]!, stretches = layoutAlignSelf === 'AUTO' || layoutAlignSelf === 'STRETCH';
  expect(result.measuredFrame).toEqual(layoutMode === 'HORIZONTAL' ? { width: 300, height: stretches ? 160 : 80 } : { width: stretches ? 300 : 80, height: 160 }); expect(result.style[layoutMode === 'HORIZONTAL' ? 'height' : 'width']).toBe(stretches ? 'auto' : 80); expect(result.style[layoutMode === 'HORIZONTAL' ? 'width' : 'height']).toBe(0);
  expect(result.style.alignSelf).toBe(({ AUTO: undefined, MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline' } as const)[layoutAlignSelf]); expect(result.style).toMatchObject({ minWidth: 40, maxWidth: 400, minHeight: 30, maxHeight: 250 }); expect(model.prototypeIssues).toEqual([]); expect(serializeGraph(graph)).toBe(source);
});
it.each(['HORIZONTAL', 'VERTICAL'] as const)('admits an explicit measured %s cross stretch without changing fixed siblings', layoutMode => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode, counterAxisAlign: 'MIN' }), fixed = graph.createNode('FRAME', frame.id, { name: 'Fixed sibling', width: 60, height: 40 }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1, layoutAlignSelf: 'STRETCH' }); graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'STRETCH' });
  const model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.children[0]!.id).toBe(`${frame.id}/0`); expect(model.nodes[0]!.children[0]!.name).toBe(fixed.name); expect(model.nodes[0]!.children[0]!.style).toMatchObject({ width: 60, height: 40 }); expect(model.nodes[0]!.children[0]!.measuredFrame).toBeUndefined(); expect(model.nodes[0]!.children[1]!.style[layoutMode === 'HORIZONTAL' ? 'height' : 'width']).toBe('auto'); expect(model.prototypeIssues).toEqual([]);
});
it.each(['hug', 'grid', 'wrapped own flow', 'wrapped parent', 'imported', 'derived', 'baked parent', 'smoothed clip'] as const)('retains the unresolved-parent diagnostic for an unproven measured %s family', family => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 200, height: 120, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 });
  if (family === 'hug') flex.primaryAxisSizing = 'HUG'; if (family === 'grid') flex.layoutMode = 'GRID'; if (family === 'wrapped own flow') Object.assign(flex, { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' }); if (family === 'wrapped parent') frame.layoutWrap = 'WRAP'; if (family === 'imported') flex.source = { ...flex.source, format: 'fig' }; if (family === 'derived') flex.derivedLayout = { width: 80, height: 80 }; if (family === 'baked parent') { flex.fills = [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }]; flex.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 2, align: 'CENTER' }]; } if (family === 'smoothed clip') Object.assign(flex, { clipsContent: true, cornerRadius: 12, cornerSmoothing: .5 });
  graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, layoutPositioning: 'ABSOLUTE', horizontalConstraint: 'STRETCH' }); const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.children[0]!.measuredFrame).toBeUndefined(); expect(model.prototypeIssues).toEqual(expect.arrayContaining([expect.stringContaining('browser-resolved size of this flex-grown layer')])); expect(() => selectionToReact(graph, [frame.id])).toThrow('browser-resolved size of this flex-grown layer'); expect(serializeGraph(graph)).toBe(source);
});
it('retains the source-backed resize refusal for baked artwork beneath a measured flex frame', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }); graph.createNode('ELLIPSE', flex.id, { name: 'Resized partial arc', x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } }); const source = serializeGraph(graph); expect(() => selectionToReact(graph, [frame.id])).toThrow('Responsive resizing of baked artwork needs source-backed rendering'); expect(serializeGraph(graph)).toBe(source);
});
it.each(['presentation', 'prepared'] as const)('keeps measured-frame metadata out of the existing %s path', path => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }); graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12 }); const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id], undefined, path === 'presentation', undefined, undefined, false, undefined, false, path === 'prepared' ? () => {} : undefined); expect(model.nodes[0]!.children[0]!.measuredFrame).toBeUndefined(); expect(serializeGraph(graph)).toBe(source);
});
it('restores temporary private source geometry and caches if initial flex layout fails partway through', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { x: 9, y: 7, width: 80, height: 80, layoutGrow: 1 }); graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'MAX' }); const source = serializeGraph(graph); let privateGraph: SceneGraph | undefined;
  vi.spyOn(sourceLayout, 'computeLayout').mockImplementationOnce(copy => { privateGraph = copy; const node = copy.getNode(flex.id)!; Object.assign(node, { x: 999, y: 777, width: 1234, height: 567 }); copy.clearAbsPosCache(); expect(copy.getAbsolutePosition(node.id).x).toBe(999); throw new Error('Interrupted source layout'); });
  expect(() => selectionToDesignModel(graph, [frame.id])).toThrow('Interrupted source layout'); expect(privateGraph!.getNode(flex.id)).toMatchObject({ x: 9, y: 7, width: 80, height: 80 }); expect(privateGraph!.getAbsolutePosition(flex.id)).toEqual({ x: 9, y: 7 }); expect(serializeGraph(graph)).toBe(source);
});
it('uses one shared initial layout pass without changing ordinary sibling paint or authored constraints', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode: 'HORIZONTAL' }), sibling = graph.createNode('RECTANGLE', frame.id, { x: 11, y: 13, width: 60, height: 40, rotation: 17, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], strokes: [{ visible: true, opacity: 1, weight: 2, align: 'CENTER', color: { r: 0, g: 0, b: 0, a: 1 } }] });
  const one = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }), two = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }); for (const owner of [one, two]) graph.createNode('RECTANGLE', owner.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'MAX' }); const source = serializeGraph(graph), layout = vi.spyOn(sourceLayout, 'computeLayout'), model = selectionToDesignModel(graph, [frame.id]), siblings = model.nodes[0]!.children;
  expect(layout).toHaveBeenCalledTimes(1); expect(siblings[0]!.id).toBe(`${frame.id}/0`); expect(siblings[0]!.name).toBe(sibling.name); expect(siblings[0]!.style).toMatchObject({ width: 60, height: 40 }); expect(siblings[0]!.image).toMatch(/^data:image\/svg/); expect(siblings.slice(1).map(node => node.measuredFrame)).toEqual([{ width: 120, height: 80 }, { width: 120, height: 80 }]); for (const node of siblings.slice(1)) expect(node.children[0]!.responsive).toMatchObject({ x: 8, y: 6, width: 20, height: 12, parentWidth: 80, parentHeight: 80 }); expect(serializeGraph(graph)).toBe(source);
});
it('retains native initial-layout refusal for an unmeasurable flow text sibling while admitting fixed or absolute text', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode: 'HORIZONTAL' }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }), text = graph.createNode('TEXT', frame.id, { text: 'Native font needed', width: 60, height: 20, textAutoResize: 'WIDTH_AND_HEIGHT' }); graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'MAX' }); const source = serializeGraph(graph); expect(() => selectionToReact(graph, [frame.id])).toThrow('browser-resolved size of this flex-grown layer'); expect(serializeGraph(graph)).toBe(source);
  text.textAutoResize = 'NONE'; expect(selectionToDesignModel(graph, [frame.id]).nodes[0]!.children[0]!.measuredFrame).toEqual({ width: 240, height: 80 }); text.textAutoResize = 'WIDTH_AND_HEIGHT'; text.layoutPositioning = 'ABSOLUTE'; expect(selectionToDesignModel(graph, [frame.id]).nodes[0]!.children[0]!.measuredFrame).toEqual({ width: 300, height: 80 });
});
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(layoutMode => [false, true].map(stretch => ({ layoutMode, stretch }))))('keeps source-derived main dimensions and only forwards the fixed cross binding for $layoutMode stretch=$stretch', ({ layoutMode, stretch }) => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 300, height: 160, layoutMode, counterAxisAlign: stretch ? 'STRETCH' : 'MIN' }), flex = graph.createNode('FRAME', frame.id, { width: 80, height: 80, layoutGrow: 1 }), child = graph.createNode('RECTANGLE', flex.id, { x: 8, y: 6, width: 20, height: 12, horizontalConstraint: 'MAX' }), collection = graph.createCollection('Measured binding axes'), width = graph.createVariable('Own width', 'FLOAT', collection.id, 90), height = graph.createVariable('Own height', 'FLOAT', collection.id, 100); graph.bindVariable(flex.id, 'width', width.id); graph.bindVariable(flex.id, 'height', height.id); setNavigation(editor, child, { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 130 }, transition: 'instant', duration: 0 }); const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children[0]!, main = layoutMode === 'HORIZONTAL' ? 'width' : 'height', cross = layoutMode === 'HORIZONTAL' ? 'height' : 'width'; expect(result.bindings?.style[main]).toBeUndefined(); expect(result.bindings?.style[cross]).toBe(stretch ? undefined : layoutMode === 'HORIZONTAL' ? height.id : width.id); expect(model.prototypeIssues).toEqual([]); expect(result.measuredFrame).toEqual(layoutMode === 'HORIZONTAL' ? { width: 300, height: stretch ? 160 : 100 } : { width: stretch ? 300 : 90, height: 160 }); expect(serializeGraph(graph)).toBe(source);
});

function nestedMeasuredFrame(outer: 'HORIZONTAL' | 'VERTICAL', inner: 'HORIZONTAL' | 'VERTICAL', stretch = false) {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Nested flow root', width: 300, height: 220, layoutMode: outer, counterAxisAlign: stretch ? 'STRETCH' : 'MIN', itemSpacing: 9, counterAxisSpacing: 13, fills: [] });
  const sibling = graph.createNode('FRAME', frame.id, { name: 'Fixed native flow sibling', width: 60, height: 40, layoutMode: 'HORIZONTAL', fills: [] });
  const flex = graph.createNode('FRAME', frame.id, { name: 'Measured own flow', width: 80, height: 80, layoutMode: inner, layoutGrow: 1, paddingTop: 6, paddingRight: 8, paddingBottom: 10, paddingLeft: 12, itemSpacing: 7, counterAxisSpacing: 11, fills: [] });
  const flow = graph.createNode('RECTANGLE', flex.id, { name: 'Fixed leaf flow', width: 20, height: 12, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
  const absolute = graph.createNode('RECTANGLE', flex.id, { name: 'Absolute constrained descendant', x: 8, y: 6, width: 20, height: 12, layoutPositioning: 'ABSOLUTE', horizontalConstraint: 'MAX', verticalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] });
  return { graph, frame, sibling, flex, flow, absolute };
}
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outer => (['HORIZONTAL', 'VERTICAL'] as const).flatMap(inner => [false, true].map(stretch => ({ outer, inner, stretch })))))('exports measured own $inner inside $outer with fixed cross size under stretch=$stretch', ({ outer, inner, stretch }) => {
  const { graph, frame, sibling, flex } = nestedMeasuredFrame(outer, inner, stretch), source = serializeGraph(graph), reference = cloneReactExportGraph(graph, [frame.id]); sourceLayout.computeAllLayouts(reference, frame.id);
  const expected = reference.getNode(flex.id)!, model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children.find(node => node.name === flex.name)!, fixed = model.nodes[0]!.children.find(node => node.name === sibling.name)!;
  expect(model.prototypeIssues).toEqual([]); expect(result.measuredFrame).toEqual({ width: expected.width, height: expected.height });
  expect(result.style).toMatchObject({ flexGrow: 1, flexBasis: 0, flexShrink: 1, minWidth: 0, minHeight: 0, [outer === 'HORIZONTAL' ? 'height' : 'width']: 80, rowGap: inner === 'HORIZONTAL' ? 11 : 7, columnGap: inner === 'HORIZONTAL' ? 7 : 11, padding: '6px 8px 10px 12px' });
  expect(fixed.style).toMatchObject({ width: 60, height: 40, flexShrink: 0 }); expect(fixed.measuredFrame).toBeUndefined(); expect(result.children.find(node => node.name === 'Fixed leaf flow')!.responsive).toBeUndefined();
  expect(result.children.find(node => node.name === 'Absolute constrained descendant')!.responsive).toMatchObject({ x: 8, y: 6, width: 20, height: 12, parentWidth: 80, parentHeight: 80, horizontal: 'MAX', vertical: 'STRETCH' });
  expect(model.nodes[0]!.style).toMatchObject({ rowGap: outer === 'HORIZONTAL' ? 13 : 9, columnGap: outer === 'HORIZONTAL' ? 9 : 13 }); expect(serializeGraph(graph)).toBe(source);
});
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outer => [false, true].map(self => ({ outer, self }))))('keeps numeric own-flow cross dimensions with $outer explicit self-stretch=$self and forwards only their live cross binding', ({ outer, self }) => {
  const { graph, frame, flex } = nestedMeasuredFrame(outer, 'HORIZONTAL', true), collection = graph.createCollection('Nested sizing'), width = graph.createVariable('Nested width', 'FLOAT', collection.id, 90), height = graph.createVariable('Nested height', 'FLOAT', collection.id, 100);
  if (self) flex.layoutAlignSelf = 'STRETCH'; graph.bindVariable(flex.id, 'width', width.id); graph.bindVariable(flex.id, 'height', height.id);
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children.find(node => node.name === flex.name)!, main = outer === 'HORIZONTAL' ? 'width' : 'height', cross = main === 'width' ? 'height' : 'width';
  expect(result.style[cross]).toBe(outer === 'HORIZONTAL' ? 100 : 90); expect(result.bindings?.style[cross]).toBe(outer === 'HORIZONTAL' ? height.id : width.id); expect(result.bindings?.style[main]).toBeUndefined(); expect(result.style.alignSelf).toBe(self ? 'stretch' : undefined); expect(model.prototypeIssues).toEqual([]); expect(serializeGraph(graph)).toBe(source);
});
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(inner => [false, true].map(between => ({ inner, between }))))('maps bound primary gap for own $inner flow with SPACE_BETWEEN=$between without binding the cross gap', ({ inner, between }) => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', inner), collection = graph.createCollection('Nested gap'), gap = graph.createVariable('Primary gap', 'FLOAT', collection.id, 17), min = graph.createVariable('Minimum width', 'FLOAT', collection.id, 45);
  if (between) flex.primaryAxisAlign = 'SPACE_BETWEEN'; graph.bindVariable(flex.id, 'itemSpacing', gap.id); graph.bindVariable(flex.id, 'minWidth', min.id); Object.assign(flex, { maxWidth: 260, minHeight: 25, maxHeight: 150 });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children.find(node => node.name === flex.name)!, primary = inner === 'HORIZONTAL' ? 'columnGap' : 'rowGap', secondary = primary === 'columnGap' ? 'rowGap' : 'columnGap';
  expect(result.style[primary]).toBe(between ? 0 : 17); expect(result.style[secondary]).toBe(11); expect(result.style.gap).toBeUndefined(); expect(result.bindings?.style.gap).toBeUndefined(); expect(result.bindings?.style[primary]).toBe(between ? undefined : gap.id); expect(result.bindings?.style[secondary]).toBeUndefined(); expect(result.bindings?.style.minWidth).toBe(min.id); expect(result.style).toMatchObject({ minWidth: 45, maxWidth: 260, minHeight: 25, maxHeight: 150 }); expect(serializeGraph(graph)).toBe(source);
});
it.each(['HORIZONTAL', 'VERTICAL'] as const)('keeps leaf stretching and fixed auto-layout sibling sizing distinct inside measured own %s flow', inner => {
  const { graph, frame, flex, flow } = nestedMeasuredFrame('HORIZONTAL', inner); flex.counterAxisAlign = 'STRETCH';
  const fixed = graph.createNode('FRAME', flex.id, { name: 'Fixed inner auto flow', width: 24, height: 18, layoutMode: 'VERTICAL', itemSpacing: 4, counterAxisSpacing: 6, fills: [] }), weighted = graph.createNode('FRAME', flex.id, { name: 'Weighted inner flow', width: 30, height: 22, layoutMode: 'HORIZONTAL', layoutGrow: 2, fills: [] });
  graph.createNode('RECTANGLE', fixed.id, { name: 'Nested fixed leaf', width: 8, height: 6, fills: [] }); graph.createNode('RECTANGLE', weighted.id, { name: 'Nested weighted absolute', x: 2, y: 3, width: 4, height: 5, layoutPositioning: 'ABSOLUTE', horizontalConstraint: 'MAX', fills: [] });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children.find(node => node.name === flex.name)!, leaf = result.children.find(node => node.name === flow.name)!, fixedResult = result.children.find(node => node.name === fixed.name)!, weightedResult = result.children.find(node => node.name === weighted.name)!;
  expect(leaf.style[inner === 'HORIZONTAL' ? 'height' : 'width']).toBe('auto'); expect(fixedResult.style).toMatchObject({ width: 24, height: 18, rowGap: 4, columnGap: 6 }); expect(weightedResult.style).toMatchObject({ flexGrow: 2, flexShrink: 1, flexBasis: 0, [inner === 'HORIZONTAL' ? 'height' : 'width']: inner === 'HORIZONTAL' ? 22 : 30 }); expect(weightedResult.measuredFrame).toBeDefined(); expect(weightedResult.children[0]!.responsive).toMatchObject({ parentWidth: 30, parentHeight: 22, horizontal: 'MAX' }); expect(model.prototypeIssues).toEqual([]); expect(serializeGraph(graph)).toBe(source);
});
it.each(['hug', 'grid', 'wrap', 'text', 'derived', 'imported'] as const)('retains the unsupported nested-flow %s family behind the existing size diagnostic', family => {
  const { graph, frame, flex, flow } = nestedMeasuredFrame('HORIZONTAL', 'VERTICAL');
  if (family === 'hug') flex.counterAxisSizing = 'HUG'; if (family === 'grid') flow.layoutMode = 'GRID'; if (family === 'wrap') Object.assign(flow, { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' }); if (family === 'text') graph.createNode('TEXT', flex.id, { text: 'Measured native font', textAutoResize: 'WIDTH_AND_HEIGHT', width: 20, height: 12 }); if (family === 'derived') flow.derivedLayout = { width: 20, height: 12 }; if (family === 'imported') flow.source = { ...flow.source, format: 'fig' };
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.children.find(node => node.name === flex.name)!.measuredFrame).toBeUndefined(); expect(() => selectionToReact(graph, [frame.id])).toThrow('browser-resolved size of this flex-grown layer'); expect(serializeGraph(graph)).toBe(source);
});
it('keeps a cross-stretched baked flow sibling refused instead of silently resizing its source pixels', () => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', 'HORIZONTAL'); flex.counterAxisAlign = 'STRETCH'; graph.createNode('ELLIPSE', flex.id, { name: 'Unsupported stretched arc', width: 20, height: 12, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } });
  const source = serializeGraph(graph); expect(() => selectionToReact(graph, [frame.id])).toThrow('Responsive resizing of baked artwork needs source-backed rendering'); expect(serializeGraph(graph)).toBe(source);
});
it.each(['imported', 'derived'] as const)('leaves absolute %s auto-layout descendants on their prior paint/layout path', family => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', 'HORIZONTAL'), absolute = graph.createNode('FRAME', flex.id, { name: 'Excluded absolute layout', width: 40, height: 30, layoutMode: 'VERTICAL', layoutPositioning: 'ABSOLUTE', itemSpacing: 3, counterAxisSpacing: 9, fills: [] });
  if (family === 'imported') absolute.source = { ...absolute.source, format: 'fig' }; else absolute.derivedLayout = { width: 40, height: 30 };
  graph.createNode('RECTANGLE', absolute.id, { width: 5, height: 6, fills: [] });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), measured = model.nodes[0]!.children.find(node => node.name === flex.name)!, excluded = measured.children.find(node => node.name === absolute.name)!;
  expect(measured.measuredFrame).toBeDefined(); expect(excluded.measuredFrame).toBeUndefined(); expect(excluded.style).toMatchObject({ gap: 3, width: 40, height: 30 }); expect(excluded.style.rowGap).toBeUndefined(); expect(excluded.style.columnGap).toBeUndefined(); expect(excluded.style.flexBasis).toBeUndefined(); expect(serializeGraph(graph)).toBe(source);
});
it.each(['imported', 'derived'] as const)('requires ordinary provenance of a measured own-flow frame’s %s immediate parent', family => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', 'VERTICAL'); if (family === 'imported') frame.source = { ...frame.source, format: 'fig' }; else frame.derivedLayout = { width: 300, height: 220 };
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.children.find(node => node.name === flex.name)!.measuredFrame).toBeUndefined(); expect(() => selectionToReact(graph, [frame.id])).toThrow('browser-resolved size of this flex-grown layer'); expect(serializeGraph(graph)).toBe(source);
});
it.each(['HORIZONTAL', 'VERTICAL'] as const)('keeps the derived cross size of a stretched bound leaf inside own %s flow', inner => {
  const { graph, frame, flex, flow } = nestedMeasuredFrame('HORIZONTAL', inner), collection = graph.createCollection('Leaf cross sizing'), cross = inner === 'HORIZONTAL' ? 'height' : 'width', size = graph.createVariable('Ignored derived cross size', 'FLOAT', collection.id, 55); flex.counterAxisAlign = 'STRETCH'; graph.bindVariable(flow.id, cross, size.id);
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]), leaf = model.nodes[0]!.children.find(node => node.name === flex.name)!.children.find(node => node.name === flow.name)!; expect(leaf.style[cross]).toBe('auto'); expect(leaf.bindings?.style[cross]).toBeUndefined(); expect(model.prototypeIssues).toEqual([]); expect(serializeGraph(graph)).toBe(source);
});
it('retains the size diagnostic for a prototype-fixed FLOW sibling instead of treating its clip as a flex item', async () => {
  const { setScrollBehaviour } = await import('./prototypeScroll'), { graph, frame, flex, flow } = nestedMeasuredFrame('HORIZONTAL', 'VERTICAL');
  graph.reparentNode(flex.id, editor.state.currentPageId); setScrollBehaviour(editor, flow, 'fixed'); graph.reparentNode(flex.id, frame.id);
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.children.find(node => node.name === flex.name)!.measuredFrame).toBeUndefined(); expect(() => selectionToReact(graph, [frame.id])).toThrow('browser-resolved size of this flex-grown layer'); expect(serializeGraph(graph)).toBe(source);
});
it('retains resolved Yoga layout direction when an ordinary flex selection is exported without its RTL ancestor', () => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', 'VERTICAL'), ancestor = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Unselected RTL owner', width: 400, height: 300, layoutDirection: 'RTL', fills: [] }); graph.reparentNode(frame.id, ancestor.id);
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]); expect(model.nodes[0]!.style.direction).toBe('rtl'); expect(model.nodes[0]!.children.find(node => node.name === flex.name)!.style.direction).toBe('rtl'); expect(model.prototypeIssues).toEqual([]); expect(serializeGraph(graph)).toBe(source);
});
it.each(['presentation', 'prepared'] as const)('keeps own-flow measurement and scoped CSS out of the native %s model path', path => {
  const { graph, frame, flex } = nestedMeasuredFrame('HORIZONTAL', 'VERTICAL'), source = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id], undefined, path === 'presentation', undefined, undefined, false, undefined, false, path === 'prepared' ? () => {} : undefined), node = model.nodes[0]!.children.find(node => node.name === flex.name)!;
  expect(node.measuredFrame).toBeUndefined(); expect(node.style.flexBasis).toBeUndefined(); expect(node.style.rowGap).toBeUndefined(); expect(node.style.columnGap).toBeUndefined(); expect(node.style.gap).toBe(7); expect(serializeGraph(graph)).toBe(source);
});
it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(inner => [false, true].map(between => ({ inner, between }))))('matches native zero-clamped authored negative gaps for own $inner with SPACE_BETWEEN=$between', ({ inner, between }) => {
  const { graph, frame, flex, flow } = nestedMeasuredFrame('HORIZONTAL', inner); Object.assign(flex, { itemSpacing: -5, counterAxisSpacing: -7, primaryAxisAlign: between ? 'SPACE_BETWEEN' : 'MIN' });
  const second = graph.createNode('RECTANGLE', flex.id, { name: 'Negative gap second leaf', width: 20, height: 12, fills: [] }), source = serializeGraph(graph), reference = cloneReactExportGraph(graph, [frame.id]); sourceLayout.computeAllLayouts(reference, frame.id);
  const first = reference.getNode(flow.id)!, next = reference.getNode(second.id)!, expected = reference.getNode(flex.id)!;
  if (!between) expect(inner === 'HORIZONTAL' ? next.x - first.x - first.width : next.y - first.y - first.height).toBe(0);
  const model = selectionToDesignModel(graph, [frame.id]), result = model.nodes[0]!.children.find(node => node.name === flex.name)!;
  expect(result.style.rowGap).toBe(0); expect(result.style.columnGap).toBe(0); expect(result.measuredFrame).toEqual({ width: expected.width, height: expected.height }); expect(model.prototypeIssues).toEqual([]); expect(flex.itemSpacing).toBe(-5); expect(flex.counterAxisSpacing).toBe(-7); expect(serializeGraph(graph)).toBe(source);
});
it('refuses responsive arc regeneration when partial ellipse artwork cannot be regenerated', () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80 }), collection = graph.createCollection('Responsive compositions'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100); graph.bindVariable(frame.id, 'width', width.id);
  graph.createNode('ELLIPSE', frame.id, { name: 'Partial arc', x: 8, y: 8, width: 30, height: 30, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } });
  expect(() => selectionToReact(graph, [frame.id])).toThrow('Responsive resizing of baked artwork needs source-backed rendering');
});
it('reflows live artwork inside exported interactive component variants', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80 }), run = graph.createNode('TEXT', frame.id, { name: 'Grow variant host', text: 'Grow', width: 80, height: 20 });
  const collection = graph.createCollection('Variant responsive'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100); graph.bindVariable(frame.id, 'width', width.id);
  const owner = booleanControl('toggle', 'Responsive toggle'); owner.width = 40; owner.height = 30;
  const mark = graph.getChildren(owner.id).find(node => node.name === 'Mark')!; Object.assign(mark, { x: 5, y: 5, width: 10, height: 10, horizontalConstraint: 'STRETCH' });
  mark.fills = [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0.4, b: 1, a: 1 } }];
  const instance = graph.createInstance(owner.id, frame.id, { x: 10, y: 10 })!; instance.horizontalConstraint = 'STRETCH';
  setPrototypeInteractions(editor, run, [{ id: 'grow', trigger: { type: 'click' }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 200 }, transition: 'instant', duration: 0 } }]);
  const before = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id]);
  const variants = model.nodes[0]!.children.find(node => node.control)!.control!.variants; expect(variants.every(variant => variant.tree.responsive === undefined)).toBe(true);
  mount(frame); await act(async () => click(host.querySelector('[data-name="Grow variant host"]')!));
  const control = host.querySelector<HTMLButtonElement>('[aria-pressed]')!; await act(async () => click(control));
  const visibleMark = host.querySelector<HTMLElement>('[data-name="Mark"]')!;
  expect(visibleMark.style.width).toBe('110px'); expect(visibleMark.style.backgroundColor).toBe('rgb(0, 102, 255)'); expect(visibleMark.querySelector('img')).toBeNull(); expect(serializeGraph(graph)).toBe(before);
});
it('reports an invalid portable bound assignment without committing it or playing subsequent actions', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), run = graph.createNode('TEXT', frame.id, { name: 'Invalid resize', text: 'Resize', width: 100, height: 20 }), collection = graph.createCollection('Invalid size'), width = graph.createVariable('Width', 'FLOAT', collection.id, 320); graph.bindVariable(frame.id, 'width', width.id);
  setPrototypeInteractions(editor, run, [{ id: 'resize', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: -1 }, transition: 'instant', duration: 0 }, { action: 'back', transition: 'instant', duration: 0 }] } }]); const navigate = vi.fn(); mount(frame, { onNavigate: navigate }); await act(async () => click(host.querySelector('[data-name="Invalid resize"]')!)); expect(navigate).not.toHaveBeenCalled(); expect(host.querySelector<HTMLElement>('[data-xdesign-view]')!.style.width).toBe('320px'); expect(host.querySelector('[role=alert]')?.textContent).toContain('invalid width');
});

it('delivers reversible jobs and actual video-clock events from the exact emitted React module', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true })); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), hotspot = editor.graph.createNode('TEXT', frame.id, { name: 'Held', text: 'Held' }); setPrototypeInteractions(editor, hotspot, [{ id: 'press', trigger: { type: 'press' }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]);
  let finish!: () => void; const release = vi.fn(() => finish()), finished = new Promise<void>(yes => { finish = yes; }), reversible = vi.fn(() => Object.assign(release, { finished })); mount(frame, { onReversible: reversible });
  const opener = host.querySelector<HTMLElement>('[data-name=Held]')!; vi.spyOn(opener, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect); const down = new MouseEvent('pointerdown', { bubbles: true }); Object.defineProperty(down, 'pointerId', { value: 4 }); await act(async () => opener.dispatchEvent(down)); expect(reversible).toHaveBeenCalledOnce(); const up = new MouseEvent('pointerup', { bubbles: true }); Object.defineProperty(up, 'pointerId', { value: 4 }); await act(async () => document.dispatchEvent(up)); expect(release).toHaveBeenCalledOnce();
  const id = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Timed video', width: 320, height: 180, duration: 3 }, 0, 0), video = editor.graph.getNode(id)!; setPrototypeInteractions(editor, video, [{ id: 'time', trigger: { type: 'media-hit', time: 1.25 }, navigation: { action: 'back', transition: 'instant', duration: 0 } }]); const navigate = vi.fn(); mount(video, { onNavigate: navigate }); const media = host.querySelector('video')!; Object.defineProperties(media, { currentTime: { value: 1.3 }, duration: { value: 3 } }); await act(async () => media.dispatchEvent(new Event('timeupdate'))); expect(navigate).toHaveBeenCalledWith({ action: 'back', transition: 'instant', duration: 0 }, video.id, { type: 'media-hit', time: 1.25 }); vi.unstubAllGlobals();
});

it('delivers On drag and its full navigation sequence through the exact emitted standalone React runtime', async () => {
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 320, height: 480 }), target = editor.graph.createNode('FRAME', editor.state.currentPageId), node = editor.graph.createNode('RECTANGLE', frame.id, { name: 'Drag export', width: 100, height: 100 }), navigation: DesignNavigation = { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'navigate', target: target.id, transition: 'smart', duration: 300 }, { action: 'back', transition: 'push', direction: 'left', duration: 250 }] }; setPrototypeInteractions(editor, node, [{ id: 'drag', trigger: { type: 'drag' }, navigation }]);
  let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), update = vi.fn(), release = vi.fn(), cancel = vi.fn(finish), onDrag = vi.fn(() => Object.assign(cancel, { finished, update, release })); const exported = mount(frame, { onDrag }); expect(exported.code).toContain('observeDesignDrag'); expect(exported.code).toContain('"type": "drag"');
  const source = host.querySelector<HTMLElement>('[data-name="Drag export"]')!; const event = (type: string, x: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20 }); act(() => source.dispatchEvent(event('pointerdown', 10))); act(() => document.dispatchEvent(event('pointermove', 40))); expect(onDrag.mock.calls[0]).toEqual([navigation, `${frame.id}/0`, { x: 0, y: 0 }]); expect(update).toHaveBeenCalledWith(expect.objectContaining({ offset: { x: 30, y: 0 } })); act(() => document.dispatchEvent(event('pointerup', 50))); expect(release).toHaveBeenCalledWith(expect.objectContaining({ offset: { x: 40, y: 0 } })); await act(async () => finish());
});


it('retains only exported asset credits and escapes metadata in standalone React code',()=>{
  const page=editor.state.currentPageId,frame=editor.graph.createNode('FRAME',page,{name:'Credited',width:120,height:80});
  frame.pluginData.push({pluginId:'orion.xdesign.asset',key:'source',value:JSON.stringify({provider:'Iconify',sourceId:'test:heart',source:'https://example.com/icon',author:'<Artist>'})});
  const unused=editor.graph.createNode('RECTANGLE',page,{name:'Unused'});unused.pluginData.push({pluginId:'orion.xdesign.asset',key:'source',value:JSON.stringify({provider:'Iconify',sourceId:'unused',source:'https://example.com/unused'})});
  const {code}=selectionToReact(editor.graph,[frame.id]);expect(code).toContain('export const designAssetCredits');expect(code).toContain('test:heart');expect(code).not.toContain('https://example.com/unused');expect(code).toContain('\\u003cArtist>');expect(code).not.toContain('<Artist>');mount(frame);expect(host.querySelector('[data-name="Credited"]')).not.toBeNull();
});

function expectSelectionCorners(graph: SceneGraph, selected: readonly SceneNode[]) {
  const bounds = selected.map(source => getAxisAlignedWorldBounds(graph.getNode(source.id)!, graph)), minX = Math.min(...bounds.map(rect => rect.x)), minY = Math.min(...bounds.map(rect => rect.y));
  const width = Math.max(...bounds.map(rect => rect.x + rect.width)) - minX, height = Math.max(...bounds.map(rect => rect.y + rect.height)) - minY, view = host.querySelector<HTMLElement>('[data-xdesign-view]')!;
  expect(Number.parseFloat(view.style.width)).toBeCloseTo(width, 8); expect(Number.parseFloat(view.style.height)).toBeCloseTo(height, 8);
  for (const source of selected) {
    const expected = graph.getNode(source.id)!, element = [...view.querySelectorAll<HTMLElement>('[data-xdesign-layer]')].find(node => node.dataset.xdesignLayer === source.id)!, matrix = getWorldMatrix(expected, graph);
    if (!expected.visible) { expect(element).toBeUndefined(); continue; }
    expect(element).toBeDefined(); expect(element.style.transformOrigin).toBe('0 0'); expect([Number.parseFloat(element.style.width), Number.parseFloat(element.style.height)]).toEqual([expected.width, expected.height]);
    const [a, b, c, d, x, y] = element.style.transform.slice(7, -1).split(',').map(Number), left = Number.parseFloat(element.style.left), top = Number.parseFloat(element.style.top);
    for (const [cx, cy] of [[0, 0], [expected.width, 0], [expected.width, expected.height], [0, expected.height]]) {
      expect(left + a! * cx! + c! * cy! + x!).toBeCloseTo(matrix[0]! * cx! + matrix[1]! * cy! + matrix[2]! - minX, 8);
      expect(top + b! * cx! + d! * cy! + y!).toBeCloseTo(matrix[3]! * cx! + matrix[4]! * cy! + matrix[5]! - minY, 8);
    }
    const motion = JSON.parse(element.getAttribute('data-xdesign-motion')!); expect([motion.width, motion.height]).toEqual([expected.width, expected.height]); expect(motion.local[4]).toBeCloseTo(left, 8); expect(motion.local[5]).toBeCloseTo(top, 8);
  }
}

it.each(['width', 'height', 'both'] as const)('renormalizes a selected root and its inherited quarter-turn envelope for a live %s binding', async axis => {
  const graph = editor.graph, ancestor = graph.createNode('FRAME', editor.state.currentPageId, { x: 140, y: 90, width: 160, height: 100, rotation: 90, flipX: true, fills: [] }), parent = graph.createNode('FRAME', ancestor.id, { x: 12, y: 8, width: 100, height: 80, flipY: true, fills: [] });
  const frame = graph.createNode('FRAME', parent.id, { name: 'Selected live root', x: 7, y: 11, width: 40, height: 20, fills: [] }), trigger = graph.createNode('RECTANGLE', frame.id, { name: 'Resize selected root', x: 2, y: 2, width: 8, height: 6, fills: [] });
  const collection = graph.createCollection('Selected root dimensions'), width = graph.createVariable('Width', 'FLOAT', collection.id, 40), height = graph.createVariable('Height', 'FLOAT', collection.id, 20);
  if (axis !== 'height') graph.bindVariable(frame.id, 'width', width.id); if (axis !== 'width') graph.bindVariable(frame.id, 'height', height.id);
  setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 80 }, transition: 'instant', duration: 0 }, { action: 'set-variable', variable: height.id, value: { type: 'literal', value: 50 }, transition: 'instant', duration: 0 }] });
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Persistent root video', width: 8, height: 6, duration: 3 }, 12, 4, frame.id);
  const source = serializeGraph(graph), independent = cloneReactExportGraph(graph, [frame.id]); mount(frame); const media = host.querySelector('video')!; media.currentTime = 1.5;
  expectSelectionCorners(independent, [frame]); await act(async () => click(host.querySelector('[data-name="Resize selected root"]')!));
  Object.assign(independent.getNode(frame.id)!, { width: axis === 'height' ? 40 : 80, height: axis === 'width' ? 20 : 50 }); independent.clearAbsPosCache(); expectSelectionCorners(independent, [frame]);
  expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1.5); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(serializeGraph(graph)).toBe(source);
});

it('recomputes every selected root placement and the shared union across different reflected ancestors and a static anchor', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, firstParent = graph.createNode('FRAME', page, { x: -120, y: -100, width: 160, height: 100, rotation: 90, fills: [] }), secondParent = graph.createNode('FRAME', page, { x: 180, y: 70, width: 120, height: 90, rotation: -25, flipY: true, fills: [] });
  const first = graph.createNode('FRAME', firstParent.id, { name: 'Selected first', x: 12, y: 8, width: 40, height: 20, flipX: true, fills: [] }), second = graph.createNode('FRAME', secondParent.id, { name: 'Selected second', x: 10, y: 5, width: 30, height: 25, rotation: 17, flipX: true, fills: [] }), anchor = graph.createNode('RECTANGLE', page, { name: 'Static selected anchor', x: 400, y: 250, width: 10, height: 10, fills: [] });
  const trigger = graph.createNode('RECTANGLE', first.id, { name: 'Resize selected union', x: 2, y: 2, width: 8, height: 6, fills: [] }), collection = graph.createCollection('Selected union'), width = graph.createVariable('First width', 'FLOAT', collection.id, 40), height = graph.createVariable('Root height', 'FLOAT', collection.id, 20), otherHeight = graph.createVariable('Other height', 'FLOAT', collection.id, 25);
  graph.bindVariable(first.id, 'width', width.id); graph.bindVariable(first.id, 'height', height.id); graph.bindVariable(second.id, 'height', otherHeight.id);
  setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: ([[width, 80], [height, 50], [otherHeight, 45]] as const).map(([variable, value]) => ({ action: 'set-variable' as const, variable: variable.id, value: { type: 'literal' as const, value }, transition: 'instant' as const, duration: 0 })) });
  const hidden = graph.createNode('FRAME', page, { name: 'Hidden static selected root', x: 450, y: -200, width: 20, height: 10, visible: false, fills: [] });
  const selected = [first, second, anchor, hidden], source = serializeGraph(graph), independent = cloneReactExportGraph(graph, selected.map(node => node.id)); mount(selected); expectSelectionCorners(independent, selected);
  const anchorElement = host.querySelector<HTMLElement>('[data-name="Static selected anchor"]')!, left = anchorElement.style.left;
  await act(async () => click(host.querySelector('[data-name="Resize selected union"]')!)); Object.assign(independent.getNode(first.id)!, { width: 80, height: 50 }); independent.getNode(second.id)!.height = 45; independent.clearAbsPosCache();
  expectSelectionCorners(independent, selected); expect(anchorElement.style.left).not.toBe(left); expect(serializeGraph(graph)).toBe(source);
});

it('uses the origin rotation and live center reflection of a selected bound LINE while retaining baked-line resize refusal', async () => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { x: 50, y: 30, width: 160, height: 100, rotation: 23, flipY: true, fills: [] }), line = graph.createNode('LINE', parent.id, { name: 'Selected reflected line', x: 12, y: 7, width: 40, height: 4, rotation: 37, flipX: true, flipY: true, fills: [] });
  const collection = graph.createCollection('Selected LINE'), width = graph.createVariable('Width', 'FLOAT', collection.id, 40), height = graph.createVariable('Height', 'FLOAT', collection.id, 4); graph.bindVariable(line.id, 'width', width.id); graph.bindVariable(line.id, 'height', height.id);
  setNavigation(editor, line, { action: 'sequence', transition: 'instant', duration: 0, actions: ([[width, 80], [height, 6]] as const).map(([variable, value]) => ({ action: 'set-variable' as const, variable: variable.id, value: { type: 'literal' as const, value }, transition: 'instant' as const, duration: 0 })) });
  const source = serializeGraph(graph), independent = cloneReactExportGraph(graph, [line.id]); mount(line); expectSelectionCorners(independent, [line]); await act(async () => click(host.querySelector('[data-name="Selected reflected line"]')!)); Object.assign(independent.getNode(line.id)!, { width: 80, height: 6 }); independent.clearAbsPosCache(); expectSelectionCorners(independent, [line]); expect(serializeGraph(graph)).toBe(source);
  line.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 2, align: 'CENTER' }]; const stroked = serializeGraph(graph); expect(() => selectionToReact(graph, [line.id])).toThrow('Responsive resizing of baked artwork'); expect(serializeGraph(graph)).toBe(stroked);
  line.strokes = []; graph.bindVariable(line.id, 'x', width.id); const positioned = serializeGraph(graph), positionReference = cloneReactExportGraph(graph, [line.id]); materializePrototypeBindings(positionReference, capturePrototypeVariables(graph)); mount(line); expectSelectionCorners(positionReference, [line]);
  await act(async () => click(host.querySelector('[data-name="Selected reflected line"]')!)); Object.assign(positionReference.getNode(line.id)!, { x: 80, width: 80, height: 6 }); positionReference.clearAbsPosCache(); expectSelectionCorners(positionReference, [line]); expect(serializeGraph(graph)).toBe(positioned);
});

it('preserves no-variable selected root corners for ordinary, component, video and reflected LINE families', () => {
  const graph = editor.graph, page = editor.state.currentPageId, ancestor = graph.createNode('FRAME', page, { x: 90, y: 40, width: 300, height: 200, rotation: 29, flipX: true, fills: [] });
  const plain = graph.createNode('FRAME', ancestor.id, { name: 'Static selected frame', x: 10, y: 8, width: 40, height: 20, rotation: 90, fills: [] }), line = graph.createNode('LINE', ancestor.id, { name: 'Static selected line', x: 70, y: 8, width: 40, height: 4, rotation: -21, flipX: true, flipY: true, fills: [] });
  const control = booleanControl('checkbox', 'Static selected checkbox'); Object.assign(control, { x: 400, y: 100, rotation: 13, flipY: true });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Static selected video', width: 30, height: 20, duration: 3 }, 130, 60, ancestor.id), video = graph.getNode(videoId)!; Object.assign(video, { rotation: 37, flipY: true });
  const selected = [plain, line, control, video], source = serializeGraph(graph), independent = cloneReactExportGraph(graph, selected.map(node => node.id)); mount(selected); expectSelectionCorners(independent, selected);
  const checkbox = host.querySelector('[role="checkbox"]')!; click(checkbox); expect(checkbox.getAttribute('aria-checked')).toBe('true'); expectSelectionCorners(independent, selected); expect(serializeGraph(graph)).toBe(source);
});

it.each(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'GROUP'] as const)('updates selected roots through shared bound ancestor %s geometry from authored rectangles without SCALE rounding drift', async constraint => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, page = editor.state.currentPageId, outer = graph.createNode('FRAME', page, { x: -80, y: 30, width: 120, height: 90, rotation: 23, flipX: true, fills: [] });
  const parent = graph.createNode(constraint === 'GROUP' ? 'GROUP' : 'FRAME', outer.id, { name: 'Unselected bound ancestor', x: 10, y: 8, width: 7, height: 11, rotation: 17, flipY: true, fills: [] });
  const mode = constraint === 'GROUP' ? 'MIN' : constraint;
  const first = graph.createNode('FRAME', parent.id, { name: 'Ancestor constrained root', x: 2, y: 3, width: 3, height: 4, rotation: 31, flipX: true, horizontalConstraint: mode, verticalConstraint: mode, fills: [] });
  const second = graph.createNode('FRAME', parent.id, { name: 'Explicit selected width', x: 1, y: 2, width: 5, height: 4, rotation: -19, horizontalConstraint: 'STRETCH', verticalConstraint: 'MAX', fills: [] });
  const inner = graph.createNode('FRAME', parent.id, { name: 'Explicit nested ancestor', x: 1, y: 2, width: 5, height: 7, rotation: -13, flipX: true, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [] });
  const third = graph.createNode('FRAME', inner.id, { name: 'Nested selected root', x: 2, y: 1, width: 2, height: 3, horizontalConstraint: 'CENTER', verticalConstraint: 'SCALE', fills: [] });
  const line = graph.createNode('LINE', parent.id, { name: 'Ancestor reflected LINE', x: 2, y: 1, width: 3, height: 2, rotation: 37, flipX: true, flipY: true, horizontalConstraint: mode, verticalConstraint: mode, fills: [] });
  const anchor = graph.createNode('FRAME', page, { name: 'Ancestor static anchor', x: 180, y: 130, width: 30, height: 20, fills: [] }), hidden = graph.createNode('FRAME', page, { x: -180, y: -110, width: 10, height: 8, visible: false, fills: [] });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Ancestor stable video', width: 2, height: 2, duration: 3 }, 0, 0, first.id);
  const collection = graph.createCollection('Ancestor geometry'), defaults = [10, 17, 90, 8, 13, 2, 3, 6] as const, variables = defaults.map((value, index) => graph.createVariable(`Ancestor value ${index}`, 'FLOAT', collection.id, value));
  for (const [index, field] of ['width', 'height', 'rotation', 'x', 'y'].entries()) graph.bindVariable(parent.id, field!, variables[index]!.id);
  graph.bindVariable(inner.id, 'x', variables[5]!.id); graph.bindVariable(inner.id, 'y', variables[6]!.id); graph.bindVariable(second.id, 'width', variables[7]!.id);
  const next = [11, 23, 37, 19, -7, 5, 6, 9], other = [14, 13, -41, -5, 27, -2, 8, 7];
  for (const [name, values, x] of [['Ancestor grow', next, 0], ['Ancestor shrink', other, 12]] as const) {
    const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 8, height: 8, fills: [] });
    setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: variables.map((variable, index) => ({ action: 'set-variable', variable: variable.id, value: { type: 'literal', value: values[index]! }, transition: 'instant', duration: 0 })) });
  }
  const selected = [first, second, third, line, anchor, hidden], ids = selected.map(node => node.id), definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), model = selectionToDesignModel(graph, ids), modelSource = JSON.stringify(model);
  const metadata = model.nodes[0]!.selectionRoot!.geometry!; expect(new Set(metadata.map(node => node.id)).size).toBe(metadata.length); expect(metadata.length).toBeLessThan(graph.nodes.size); expect(model.nodes.slice(1).every(node => !node.selectionRoot?.geometry)).toBe(true);
  mount(selected); const media = host.querySelector('video')!; media.currentTime = 1.25;
  const assertValues = (values: readonly number[]) => {
    let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! });
    const independent = cloneReactExportGraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, selected);
    expect(host.querySelector(`[data-xdesign-layer="${first.id}/0"] video`)).toBe(media); expect(media.currentTime).toBe(1.25); expect(graph.getNode(videoId)).toBeDefined();
  };
  assertValues(defaults);
  for (const [name, values] of [['Ancestor grow', next], ['Ancestor shrink', other], ['Ancestor grow', next]] as const) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); assertValues(values); }
  expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(JSON.stringify(model)).toBe(modelSource); expect(serializeGraph(graph)).toBe(source);
});

it('resolves inherited ancestor modes and cross-collection aliases while sharing selection geometry between different parents', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, collection = graph.createCollection('Ancestor modes'), dark = crypto.randomUUID(); graph.addMode(collection.id, dark, 'Large');
  const width = graph.createVariable('Ancestor width', 'FLOAT', collection.id, 13), angle = graph.createVariable('Ancestor rotation', 'FLOAT', collection.id, 0); editor.updateVariableValue(width.id, dark, 27); editor.updateVariableValue(angle.id, dark, 90);
  const aliases = graph.createCollection('Ancestor aliases'), alias = graph.createVariable('Aliased width', 'FLOAT', aliases.id, { aliasId: width.id });
  const pinned = graph.createNode('FRAME', page, { x: 30, y: 20, width: 7, height: 10, flipX: true, fills: [], variableModes: { [collection.id]: dark } }), global = graph.createNode('FRAME', page, { x: 100, y: -30, width: 7, height: 10, flipY: true, fills: [] });
  for (const parent of [pinned, global]) { graph.bindVariable(parent.id, 'width', alias.id); graph.bindVariable(parent.id, 'rotation', angle.id); }
  const first = graph.createNode('FRAME', pinned.id, { x: 2, y: 1, width: 3, height: 4, horizontalConstraint: 'SCALE', fills: [] }), second = graph.createNode('FRAME', global.id, { x: 2, y: 1, width: 3, height: 4, horizontalConstraint: 'SCALE', fills: [] });
  const anchor = graph.createNode('FRAME', page, { name: 'Mode anchor', x: 200, y: 100, width: 30, height: 20, fills: [] });
  for (const [name, mode, x] of [['Select large ancestor mode', dark, 0], ['Select default ancestor mode', collection.defaultModeId, 12]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 8, height: 8, fills: [] }); setNavigation(editor, trigger, { action: 'set-mode', collection: collection.id, mode, transition: 'instant', duration: 0 }); }
  const selected = [first, second, anchor], ids = selected.map(node => node.id), definitions = capturePrototypeVariables(graph), source = serializeGraph(graph); mount(selected);
  const assertMode = (mode: string) => { const independent = cloneReactExportGraph(graph, ids), session = setPrototypeSessionMode(definitions, emptyPrototypeSession(), collection.id, mode); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, selected); expect(independent.getNode(pinned.id)!.width).toBe(27); };
  assertMode(collection.defaultModeId); await act(async () => click(host.querySelector('[data-name="Select large ancestor mode"]')!)); assertMode(dark); await act(async () => click(host.querySelector('[data-name="Select default ancestor mode"]')!)); assertMode(collection.defaultModeId); expect(serializeGraph(graph)).toBe(source);
});

it.each(['flow', 'hug', 'grow', 'grid', 'layout binding', 'control'] as const)('refuses the unsupported dynamic ancestor %s family without changing source geometry', kind => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80, fills: [] }), child = graph.createNode('FRAME', parent.id, { width: 20, height: 10, fills: [] });
  const collection = graph.createCollection('Unsupported ancestor'), width = graph.createVariable('Ancestor width', 'FLOAT', collection.id, 120); graph.bindVariable(parent.id, 'width', width.id);
  let selected = child;
  if (kind === 'flow') parent.layoutMode = 'HORIZONTAL';
  if (kind === 'hug') parent.primaryAxisSizing = 'HUG';
  if (kind === 'grow') child.layoutGrow = 1;
  if (kind === 'grid') parent.layoutMode = 'GRID';
  if (kind === 'layout binding') graph.bindVariable(parent.id, 'paddingLeft', width.id);
  if (kind === 'control') { const main = booleanControl('checkbox', 'Unsupported ancestor control'); selected = graph.createInstance(main.id, parent.id)!; }
  const source = serializeGraph(graph); expect(() => selectionToReact(graph, [selected.id])).toThrow('Variable-bound ancestor layout or realized controls'); expect(serializeGraph(graph)).toBe(source);
});

it.each(['HORIZONTAL', 'VERTICAL'] as const)('keeps absolute selected roots constrained to fixed %s ancestors with explicit own-size precedence', async layoutMode => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { x: 50, y: 40, width: 100, height: 80, rotation: -31, flipY: true, layoutMode, fills: [] });
  const selected = graph.createNode('FRAME', parent.id, { name: 'Absolute selected geometry', x: 10, y: 8, width: 20, height: 12, layoutPositioning: 'ABSOLUTE', horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [] });
  const collection = graph.createCollection('Absolute ancestor'), width = graph.createVariable('Parent width', 'FLOAT', collection.id, 120), height = graph.createVariable('Parent height', 'FLOAT', collection.id, 90), ownWidth = graph.createVariable('Root width', 'FLOAT', collection.id, 23); graph.bindVariable(parent.id, 'width', width.id); graph.bindVariable(parent.id, 'height', height.id); graph.bindVariable(selected.id, 'width', ownWidth.id);
  setNavigation(editor, selected, { action: 'sequence', transition: 'instant', duration: 0, actions: ([[width, 170], [height, 110], [ownWidth, 37]] as const).map(([variable, value]) => ({ action: 'set-variable', variable: variable.id, value: { type: 'literal', value }, transition: 'instant', duration: 0 })) });
  const definitions = capturePrototypeVariables(graph), source = serializeGraph(graph); mount(selected);
  const assertSize = (values: readonly number[]) => { let session = emptyPrototypeSession(); for (const [index, variable] of [width, height, ownWidth].entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! }); const independent = cloneReactExportGraph(graph, [selected.id]); materializePrototypeBindings(independent, definitions, session); expectSelectionCorners(independent, [selected]); };
  assertSize([120, 90, 23]); await act(async () => click(host.querySelector('[data-name="Absolute selected geometry"]')!)); assertSize([170, 110, 37]); expect(serializeGraph(graph)).toBe(source);
});

it('keeps ancestor-resized baked root artwork guarded while allowing position-only artwork and finite source geometry', () => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80, fills: [] }), child = graph.createNode('RECTANGLE', parent.id, { x: 10, y: 8, width: 20, height: 10, horizontalConstraint: 'STRETCH', strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'CENTER' }] });
  const collection = graph.createCollection('Baked ancestor'), width = graph.createVariable('Ancestor width', 'FLOAT', collection.id, 120); graph.bindVariable(parent.id, 'width', width.id);
  let source = serializeGraph(graph); expect(() => selectionToReact(graph, [child.id])).toThrow('Responsive resizing of baked artwork'); expect(serializeGraph(graph)).toBe(source);
  child.horizontalConstraint = 'MAX'; source = serializeGraph(graph); expect(() => selectionToReact(graph, [child.id])).not.toThrow(); expect(serializeGraph(graph)).toBe(source);
  editor.updateVariableValue(width.id, collection.defaultModeId, -1); source = serializeGraph(graph); expect(() => selectionToReact(graph, [child.id])).toThrow('invalid width'); expect(serializeGraph(graph)).toBe(source);
  editor.updateVariableValue(width.id, collection.defaultModeId, Number.POSITIVE_INFINITY); source = serializeGraph(graph); expect(() => selectionToReact(graph, [child.id])).toThrow('invalid value'); expect(serializeGraph(graph)).toBe(source);
  const parentId = parent.parentId;
  try { parent.parentId = child.id; source = serializeGraph(graph); expect(() => selectionToReact(graph, [child.id])).toThrow('recursive layer ancestry'); expect(serializeGraph(graph)).toBe(source); }
  finally { parent.parentId = parentId; }
});

it('serializes shared bound ancestry once for many selected roots and cancels invalid ancestor assignments before geometry changes', async () => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { width: 7, height: 11, fills: [] }), collection = graph.createCollection('Shared forest'), width = graph.createVariable('Shared width', 'FLOAT', collection.id, 10); graph.bindVariable(parent.id, 'width', width.id);
  const selected = Array.from({ length: 48 }, (_, index) => graph.createNode('FRAME', parent.id, { name: `Shared root ${index}`, x: index, width: 3, height: 4, horizontalConstraint: 'SCALE', fills: [] }));
  setNavigation(editor, selected[0]!, { action: 'set-variable', variable: width.id, value: { type: 'literal', value: -1 }, transition: 'instant', duration: 0 });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, selected.map(node => node.id)), forest = model.nodes[0]!.selectionRoot!.geometry!;
  expect(forest.filter(node => node.id === parent.id)).toHaveLength(1); expect(forest.length).toBe(selected.length + 3); expect(model.nodes.filter(node => node.selectionRoot?.geometry)).toHaveLength(1);
  mount(selected); const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!, initial = [view.style.width, view.style.height, host.querySelector<HTMLElement>('[data-name="Shared root 0"]')!.style.cssText];
  await act(async () => click(host.querySelector('[data-name="Shared root 0"]')!)); expect(host.querySelector('[role="alert"]')!.textContent).toContain('invalid width'); expect([view.style.width, view.style.height, host.querySelector<HTMLElement>('[data-name="Shared root 0"]')!.style.cssText]).toEqual(initial); expect(serializeGraph(graph)).toBe(source);
});

it.each(['x', 'y', 'quarter-turn', 'rotation', 'combined'] as const)('plays own selected-root %s bindings through the shared union in the exact generated module', async family => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, page = editor.state.currentPageId, outer = graph.createNode('FRAME', page, { x: 90, y: 50, width: 180, height: 120, rotation: 23, flipX: true, fills: [] }), parent = graph.createNode('FRAME', outer.id, { x: 12, y: 8, width: 100, height: 80, rotation: -17, flipY: true, fills: [] });
  const selected = graph.createNode('FRAME', parent.id, { name: 'Own bound selected root', x: 12, y: 7, width: 40, height: 24, flipX: true, horizontalConstraint: 'MAX', verticalConstraint: 'STRETCH', fills: [] });
  graph.createNode('RECTANGLE', selected.id, { name: 'Live selected paint', width: 40, height: 24, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Own transform stable video', width: 10, height: 8, duration: 3 }, 2, 2, selected.id);
  const anchor = graph.createNode('FRAME', page, { name: 'Own transform static anchor', x: -120, y: 180, width: 40, height: 20, fills: [] }), hidden = graph.createNode('FRAME', page, { x: 380, y: -100, width: 10, height: 10, visible: false, fills: [] });
  const fields = ['x', 'y', 'rotation', 'width', 'height'] as const, defaults = [12, 7, 0, 40, 24, 100, -17], next = [45, -13, family === 'quarter-turn' ? 90 : 37, 70, 38, 160, 11], other = [-28, 49, family === 'quarter-turn' ? -90 : -29, 52, 32, 120, -33], collection = graph.createCollection('Own selected geometry'), variables = defaults.map((value, index) => graph.createVariable(`Own geometry ${index}`, 'FLOAT', collection.id, value));
  for (const [index, field] of fields.entries()) if (family === 'combined' || family === field || ['quarter-turn', 'rotation'].includes(family) && field === 'rotation') graph.bindVariable(selected.id, field, variables[index]!.id);
  if (family === 'combined') { graph.bindVariable(parent.id, 'width', variables[5]!.id); graph.bindVariable(parent.id, 'rotation', variables[6]!.id); }
  for (const [name, values, x] of [['Move own geometry', next, 0], ['Return own geometry', other, 16]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 12, height: 10, fills: [] }); setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: variables.map((variable, index) => ({ action: 'set-variable', variable: variable.id, value: { type: 'literal', value: values[index]! }, transition: 'instant', duration: 0 })) }); }
  const roots = [selected, anchor, hidden], ids = roots.map(node => node.id), definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), model = selectionToDesignModel(graph, ids), modelSource = JSON.stringify(model);
  expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.selectionRoot!.geometryRoot).toBe(selected.id); expect(model.nodes[0]!.bindings?.style.left).toBeUndefined(); expect(model.nodes[0]!.bindings?.style.top).toBeUndefined(); expect(model.nodes[0]!.bindings?.style.transform).toBeUndefined();
  mount(roots); const media = host.querySelector('video')!, layer = host.querySelector('[data-name="Own bound selected root"]'); media.currentTime = 1.5;
  const assertValues = (values: readonly number[]) => { let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! }); const independent = cloneReactExportGraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, roots); expect(host.querySelector('[data-name="Own bound selected root"]')).toBe(layer); expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1.5); expect(graph.getNode(videoId)).toBeDefined(); };
  assertValues(defaults); for (const [name, values] of [['Move own geometry', next], ['Return own geometry', other], ['Move own geometry', next]] as const) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); assertValues(values); }
  expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(JSON.stringify(model)).toBe(modelSource); expect(serializeGraph(graph)).toBe(source);
});

it('plays own root modes and aliases across differently parented text, video and reflected LINE roots without remounting', async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, page = editor.state.currentPageId, collection = graph.createCollection('Own transform modes'), alternate = crypto.randomUUID(); graph.addMode(collection.id, alternate, 'Alternate');
  const x = graph.createVariable('Own x', 'FLOAT', collection.id, 10), y = graph.createVariable('Own y', 'FLOAT', collection.id, 8), rotation = graph.createVariable('Own angle', 'FLOAT', collection.id, 0); editor.updateVariableValue(x.id, alternate, 42); editor.updateVariableValue(y.id, alternate, -13); editor.updateVariableValue(rotation.id, alternate, 37);
  const aliases = graph.createCollection('Own geometry alias'), alias = graph.createVariable('Own alias x', 'FLOAT', aliases.id, { aliasId: x.id });
  const pinned = graph.createNode('FRAME', page, { x: 30, y: 40, width: 100, height: 80, rotation: 90, flipX: true, fills: [], variableModes: { [collection.id]: alternate } }), global = graph.createNode('FRAME', page, { x: 200, y: -30, width: 100, height: 80, rotation: -23, flipY: true, fills: [] });
  const text = graph.createNode('TEXT', pinned.id, { name: 'Own transformed text', text: 'Live position', x: 10, y: 8, width: 70, height: 20, flipY: true }), line = graph.createNode('LINE', global.id, { name: 'Own transformed LINE', x: 10, y: 8, width: 24, height: 3, flipX: true, flipY: true, fills: [] });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Own transformed video root', width: 30, height: 20, duration: 3 }, 10, 8, global.id), video = graph.getNode(videoId)!;
  for (const node of [text, line, video]) { graph.bindVariable(node.id, 'x', alias.id); graph.bindVariable(node.id, 'y', y.id); graph.bindVariable(node.id, 'rotation', rotation.id); }
  const anchor = graph.createNode('FRAME', page, { x: -80, y: 180, width: 40, height: 20, fills: [] });
  for (const [name, mode, at] of [['Own alternate mode', alternate, 0], ['Own default mode', collection.defaultModeId, 20]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x: at, width: 15, height: 10, fills: [] }); setNavigation(editor, trigger, { action: 'set-mode', collection: collection.id, mode, transition: 'instant', duration: 0 }); }
  const roots = [text, line, video, anchor], ids = roots.map(node => node.id), definitions = capturePrototypeVariables(graph), source = serializeGraph(graph); mount(roots); const media = host.querySelector('video')!; media.currentTime = 1.25;
  const assertMode = (mode: string) => { const session = setPrototypeSessionMode(definitions, emptyPrototypeSession(), collection.id, mode), independent = cloneReactExportGraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, roots); expect(independent.getNode(text.id)!.x).toBe(42); expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1.25); };
  assertMode(collection.defaultModeId); for (const [name, mode] of [['Own alternate mode', alternate], ['Own default mode', collection.defaultModeId], ['Own alternate mode', alternate]] as const) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); assertMode(mode); }
  expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(serializeGraph(graph)).toBe(source);
});

it.each(['flow', 'hug', 'grow', 'grid', 'control'] as const)('retains native fidelity refusal for an own-transform selected %s family', kind => {
  const graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { width: 100, height: 80, fills: [] }); let node = graph.createNode('FRAME', parent.id, { name: 'Guarded own root', x: 10, y: 8, width: 30, height: 20, fills: [] });
  if (kind === 'flow') parent.layoutMode = 'HORIZONTAL'; if (kind === 'hug') node.primaryAxisSizing = 'HUG'; if (kind === 'grow') node.layoutGrow = 1; if (kind === 'grid') parent.layoutMode = 'GRID'; if (kind === 'control') node = graph.createInstance(booleanControl('checkbox', 'Guarded own checkbox').id, parent.id)!;
  const collection = graph.createCollection('Guarded own transforms'), x = graph.createVariable('Root x', 'FLOAT', collection.id, 12), angle = graph.createVariable('Root angle', 'FLOAT', collection.id, 0); graph.bindVariable(node.id, 'x', x.id); graph.bindVariable(node.id, 'rotation', angle.id);
  setNavigation(editor, node, { action: 'set-variable', variable: x.id, value: { type: 'literal', value: 24 }, transition: 'instant', duration: 0 });
  const source = serializeGraph(graph); expect(() => selectionToReact(graph, [node.id])).toThrow(/native presentation/); expect(serializeGraph(graph)).toBe(source);
});

it('keeps transform-only baked SVG roots behind source-backed rendering guards', () => {
  const graph = editor.graph, node = graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Baked own transform', x: 10, y: 8, width: 30, height: 20, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }], strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 2, align: 'CENTER' }] });
  const collection = graph.createCollection('Guarded baked transforms'), x = graph.createVariable('Baked x', 'FLOAT', collection.id, 10), angle = graph.createVariable('Baked rotation', 'FLOAT', collection.id, 0); graph.bindVariable(node.id, 'x', x.id); graph.bindVariable(node.id, 'rotation', angle.id);
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [node.id]); expect(model.nodes[0]!.image).toMatch(/^data:image\/svg/); expect(model.nodes[0]!.selectionRoot!.geometryRoot).toBeUndefined(); expect(() => selectionToReact(graph, [node.id])).toThrow('Variable-bound root transforms of baked artwork'); expect(serializeGraph(graph)).toBe(source);
});

it.each(['rectangle', 'rounded', 'ellipse', 'asymmetric', 'oversized', 'oversized uniform', 'clipped frame', 'ignored ellipse smoothing', 'ignored zero-radius smoothing'] as const)('plays transformed live CSS %s paint at authored and variable sizes in the exact generated module', async family => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const graph = editor.graph, page = editor.state.currentPageId, parent = graph.createNode('FRAME', page, { x: 90, y: 60, width: 140, height: 100, rotation: 23, flipY: true, fills: [] });
  const type = family === 'ellipse' || family === 'ignored ellipse smoothing' ? 'ELLIPSE' : family === 'rounded' || family.startsWith('oversized') ? 'ROUNDED_RECTANGLE' : family === 'clipped frame' || family === 'asymmetric' ? 'FRAME' : 'RECTANGLE';
  const selected = graph.createNode(type, parent.id, { name: 'Live solid geometry', x: 12, y: 8, width: 40, height: 24, rotation: 31, flipX: true, flipY: family === 'ellipse', cornerRadius: family === 'oversized uniform' ? 80 : family === 'rounded' || family === 'clipped frame' ? 6 : 0, clipsContent: family === 'clipped frame', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
  if (family === 'asymmetric' || family === 'oversized') Object.assign(selected, { independentCorners: true, topLeftRadius: family === 'oversized' ? 80 : 3, topRightRadius: family === 'oversized' ? 30 : 8, bottomRightRadius: family === 'oversized' ? 70 : 12, bottomLeftRadius: family === 'oversized' ? 20 : 5 });
  if (family.startsWith('ignored')) Object.assign(selected, { cornerSmoothing: .6, cornerRadius: family === 'ignored ellipse smoothing' ? 8 : 0 });
  const videoId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Solid stable media', width: 10, height: 8, duration: 3 }, 2, 2, selected.id);
  const anchor = graph.createNode('FRAME', page, { x: -80, y: 180, width: 40, height: 20, fills: [] }), collection = graph.createCollection('Solid geometry playback'), defaults = [12, 8, 31, 40, 24], variables = defaults.map((value, index) => graph.createVariable(`Solid value ${index}`, 'FLOAT', collection.id, value));
  for (const [index, field] of ['x', 'y', 'rotation', 'width', 'height'].entries()) graph.bindVariable(selected.id, field!, variables[index]!.id);
  const next = [28, -12, 90, 64, 40], other = [-15, 26, -29, 32, 18];
  for (const [name, values, x] of [['Grow live solid', next, 0], ['Shrink live solid', other, 20]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 15, height: 12, fills: [] }); setNavigation(editor, trigger, { action: 'sequence', transition: 'instant', duration: 0, actions: variables.map((variable, index) => ({ action: 'set-variable', variable: variable.id, value: { type: 'literal', value: values[index]! }, transition: 'instant', duration: 0 })) }); }
  const roots = [selected, anchor], ids = roots.map(node => node.id), source = serializeGraph(graph), definitions = capturePrototypeVariables(graph), model = selectionToDesignModel(graph, ids), modelSource = JSON.stringify(model);
  expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.image).toBeUndefined(); expect(model.nodes[0]!.style.backgroundColor).toBe('rgba(255,0,0,1)'); expect(model.nodes[0]!.selectionRoot?.geometryRoot).toBe(selected.id);
  mount(roots); const media = host.querySelector('video')!; media.currentTime = 1.5;
  const assertState = (values: number[]) => { let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! }); const independent = cloneReactExportGraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, roots); const element = host.querySelector<HTMLElement>('[data-name="Live solid geometry"]')!; expect(element.style.backgroundColor).toBe('rgb(255, 0, 0)'); expect(element.style.borderRadius).toBe(String(model.nodes[0]!.style.borderRadius)); expect(element.querySelector('img')).toBeNull(); expect(!!element.querySelector('[data-xdesign-content-clip]')).toBe(family === 'clipped frame'); expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1.5); expect(graph.getNode(videoId)).toBeDefined(); };
  assertState(defaults); for (const [name, values] of [['Grow live solid', next], ['Shrink live solid', other], ['Grow live solid', next]] as const) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); assertState(values); }
  expect(JSON.stringify(model)).toBe(modelSource); expect(serializeGraph(graph)).toBe(source); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
});

it('inherits live solid color and geometry modes through constrained transformed parents and preserves source bindings', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, collection = graph.createCollection('Solid modes'), alternate = crypto.randomUUID(); graph.addMode(collection.id, alternate, 'Alternate');
  const width = graph.createVariable('Solid parent width', 'FLOAT', collection.id, 100), color = graph.createVariable('Solid color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }), angle = graph.createVariable('Solid angle', 'FLOAT', collection.id, 27); editor.updateVariableValue(width.id, alternate, 160); editor.updateVariableValue(color.id, alternate, { r: 0, g: 0, b: 1, a: 1 }); editor.updateVariableValue(angle.id, alternate, -37);
  const aliases = graph.createCollection('Solid alias'), alias = graph.createVariable('Aliased solid width', 'FLOAT', aliases.id, { aliasId: width.id }), parent = graph.createNode('FRAME', page, { x: 70, y: 50, width: 100, height: 80, rotation: 90, flipX: true, fills: [] }); graph.bindVariable(parent.id, 'width', alias.id);
  const selected = graph.createNode('RECTANGLE', parent.id, { name: 'Mode solid root', x: 10, y: 8, width: 40, height: 24, rotation: 27, flipY: true, cornerRadius: 4, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }); graph.bindVariable(selected.id, 'rotation', angle.id); graph.bindVariable(selected.id, 'fills/0/color', color.id);
  const anchor = graph.createNode('FRAME', page, { x: -80, y: 180, width: 40, height: 20, fills: [] }); for (const [name, mode, x] of [['Solid alternate mode', alternate, 0], ['Solid default mode', collection.defaultModeId, 20]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 15, height: 12, fills: [] }); setNavigation(editor, trigger, { action: 'set-mode', collection: collection.id, mode, transition: 'instant', duration: 0 }); }
  const roots = [selected, anchor], ids = roots.map(node => node.id), definitions = capturePrototypeVariables(graph), source = serializeGraph(graph); mount(roots);
  const assertMode = (mode: string) => { const independent = cloneReactExportGraph(graph, ids), session = setPrototypeSessionMode(definitions, emptyPrototypeSession(), collection.id, mode); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectionCorners(independent, roots); const element = host.querySelector<HTMLElement>('[data-name="Mode solid root"]')!; expect(element.style.backgroundColor).toBe(mode === alternate ? 'rgb(0, 0, 255)' : 'rgb(255, 0, 0)'); expect(element.querySelector('img')).toBeNull(); };
  assertMode(collection.defaultModeId); for (const [name, mode] of [['Solid alternate mode', alternate], ['Solid default mode', collection.defaultModeId], ['Solid alternate mode', alternate]] as const) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); assertMode(mode); } expect(serializeGraph(graph)).toBe(source);
});

it.each(['component', 'instance'] as const)('preserves strictly representable live fill bindings on a realized %s', async family => {
  const graph = editor.graph, owner = main('Bound container'), collection = graph.createCollection('Container paint'), color = graph.createVariable('Container color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 });
  graph.updateNode(owner.id, { width: 48, height: 32, cornerRadius: 6, clipsContent: true, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }); graph.bindVariable(owner.id, 'fills/0/color', color.id);
  graph.createNode('RECTANGLE', owner.id, { name: 'Clipped child', x: 36, y: 8, width: 20, height: 16, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] });
  const selected = family === 'component' ? owner : graph.createInstance(owner.id, editor.state.currentPageId)!;
  if (family === 'instance') graph.bindVariable(selected.id, 'fills/0/color', color.id);
  const anchor = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Container actions', x: 100, width: 40, height: 20, fills: [] });
  for (const [name, value, x] of [['Container blue', { r: 0, g: 0, b: 1, a: 1 }, 0], ['Container green', { r: 0, g: 1, b: 0, a: 1 }, 20]] as const) { const trigger = graph.createNode('RECTANGLE', anchor.id, { name, x, width: 16, height: 12, fills: [] }); setNavigation(editor, trigger, { action: 'set-variable', variable: color.id, value: { type: 'literal', value }, transition: 'instant', duration: 0 }); }
  const ids = [selected.id, anchor.id], source = serializeGraph(graph), model = selectionToDesignModel(graph, ids), savedModel = JSON.stringify(model); expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.bindings?.style.backgroundColor).toBe(color.id); expect(model.nodes[0]!.image).toBeUndefined();
  mount([selected, anchor]); const layer = host.querySelector<HTMLElement>('[data-xdesign-view] > [data-name="Bound container"]')!; expect(layer.style.backgroundColor).toBe('rgb(255, 0, 0)'); expect(layer.style.borderRadius).toBe('6px'); expect(layer.querySelector('[data-xdesign-content-clip]')).not.toBeNull(); expect(layer.querySelector('img')).toBeNull();
  for (const [name, expected] of [['Container blue', 'rgb(0, 0, 255)'], ['Container green', 'rgb(0, 255, 0)'], ['Container blue', 'rgb(0, 0, 255)']]) { await act(async () => click(host.querySelector(`[data-name="${name}"]`)!)); expect(host.querySelector('[data-xdesign-view] > [data-name="Bound container"]')).toBe(layer); expect(layer.style.backgroundColor).toBe(expected); }
  expect(JSON.stringify(model)).toBe(savedModel); expect(serializeGraph(graph)).toBe(source);
});

it('updates the visible first fill in the exact generated module while retaining a hidden extra paint', async () => {
  const graph = editor.graph, node = graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Indexed live fill', width: 40, height: 24, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }, { type: 'SOLID', visible: false, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }), collection = graph.createCollection('Indexed live color'), color = graph.createVariable('Indexed live color', 'COLOR', collection.id, { r: 0, g: 1, b: 0, a: 1 }); graph.bindVariable(node.id, 'fills/0/color', color.id); setNavigation(editor, node, { action: 'set-variable', variable: color.id, value: { type: 'literal', value: { r: 0, g: 0, b: 1, a: 1 } }, transition: 'instant', duration: 0 }); const source = serializeGraph(graph); mount(node);
  const element = host.querySelector<HTMLElement>('[data-name="Indexed live fill"]')!; expect(element.style.backgroundColor).toBe('rgb(0, 255, 0)'); expect(element.querySelector('img')).toBeNull(); await act(async () => click(element)); expect(host.querySelector('[data-name="Indexed live fill"]')).toBe(element); expect(element.style.backgroundColor).toBe('rgb(0, 0, 255)'); expect(serializeGraph(graph)).toBe(source);
});
