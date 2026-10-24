import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { serializeGraph, deserializeGraph } from './document';
import { routePrototype, readPrototype, setPrototypeInteractions, type DesignNavigation, type PrototypeRoute } from './prototype';
import { defaultOverlay, overlayPosition, readPrototypeOverlay, setPrototypeOverlay } from './prototypeOverlay';
let editor: Editor;
beforeEach(() => { editor = createEditor(); }); afterEach(() => editor.dispose());
const action = (action: DesignNavigation['action'], target?: string): DesignNavigation => ({ action, target, transition: 'instant', duration: 0 });
it('separates overlay stacks from Back history and follows close, swap and Navigate semantics', () => {
  const screens = new Set(['home', 'screen', 'dialog', 'nested', 'replacement']);
  let route: PrototypeRoute = { screen: 'home', history: [], overlays: [] };
  route = routePrototype(route, action('navigate', 'screen'), screens);
  route = routePrototype(route, { ...action('overlay', 'dialog'), offset: { x: 5, y: 8 } }, screens, { x: 30, y: 40 });
  expect(route).toMatchObject({ screen: 'screen', history: ['home'], overlays: [{ screen: 'dialog', origin: { x: 30, y: 40 }, offset: { x: 5, y: 8 } }] });
  route = routePrototype(route, action('overlay', 'nested'), screens);
  route = routePrototype(route, action('swap', 'replacement'), screens);
  expect(route.overlays.map(item => item.screen)).toEqual(['dialog', 'replacement']); expect(route.history).toEqual(['home']);
  route = routePrototype(route, action('close'), screens); expect(route.overlays.map(item => item.screen)).toEqual(['dialog']);
  route = routePrototype(route, action('back'), screens); expect(route).toEqual({ screen: 'home', history: [], overlays: [] });
  route = routePrototype(route, action('swap', 'replacement'), screens); expect(route.screen).toBe('replacement'); expect(route.history).toEqual([]);
  route = routePrototype(route, action('overlay', 'dialog'), screens);
  route = routePrototype(route, action('navigate', 'replacement'), screens); expect(route.overlays).toEqual([]); expect(route.history).toEqual([]);
  expect(routePrototype(route, action('close'), screens)).toBe(route);
});
it('refuses unresolved destinations and excessive nesting without mutating the active flow', () => {
  const screens = new Set(['home', 'dialog']), initial: PrototypeRoute = { screen: 'home', history: [], overlays: [] };
  expect(() => routePrototype(initial, { ...action('overlay', 'dialog'), unresolved: true }, screens)).toThrow('paste'); expect(initial.overlays).toEqual([]);
  let route = initial;
  for (let i = 0; i < 8; i++) route = routePrototype(route, action('overlay', 'dialog'), screens);
  expect(() => routePrototype(route, action('overlay', 'dialog'), screens)).toThrow('eight'); expect(route.overlays).toHaveLength(8);
  expect(routePrototype(route, action('swap', 'dialog'), screens).overlays).toHaveLength(8);
});
it('persists frame settings and per-interaction offsets through native undo and project reopen', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId), target = editor.graph.createNode('FRAME', editor.state.currentPageId);
  node.pluginData = [{ pluginId: 'other', key: 'keep', value: 'yes' }];
  const settings = { position: 'manual' as const, closeOutside: true, background: { r: 0.2, g: 0.3, b: 0.4, a: 0.25 } };
  setPrototypeOverlay(editor, target, settings);
  setPrototypeInteractions(editor, node, [{ id: 'click', trigger: { type: 'click' }, navigation: { ...action('overlay', target.id), offset: { x: -12, y: 14 } } }]);
  const graph = deserializeGraph(serializeGraph(editor.graph)); expect(readPrototypeOverlay(graph.getNode(target.id)!).settings).toEqual(settings); expect(readPrototype(graph.getNode(node.id)!).link?.offset).toEqual({ x: -12, y: 14 });
  editor.undoAction(); expect(readPrototype(node).link).toBeUndefined(); expect(node.pluginData).toEqual([{ pluginId: 'other', key: 'keep', value: 'yes' }]);
  editor.undoAction(); expect(readPrototypeOverlay(target).settings).toEqual(defaultOverlay()); editor.redoAction(); expect(readPrototypeOverlay(target).settings).toEqual(settings);
  editor.graph.updateNode(target.id, { locked: true }); expect(() => setPrototypeOverlay(editor, target, defaultOverlay())).toThrow('Unlock');
});
it('preserves unsupported settings and rejects invalid authoring instead of substituting playback defaults', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId);
  node.source.fig.rawNodeFields = { overlayPositionType: 'FUTURE', overlayBackgroundAppearance: { backgroundType: 'GRADIENT' } };
  expect(readPrototypeOverlay(node).issue).toContain('preserved');
  for (const bad of [{ ...defaultOverlay(), background: { r: 0, g: 0, b: 0, a: 2 } }, { ...defaultOverlay(), closeOutside: 'yes' }, { ...defaultOverlay(), position: 'unknown' }]) expect(() => setPrototypeOverlay(editor, node, bad as ReturnType<typeof defaultOverlay>)).toThrow('valid');
  setPrototypeOverlay(editor, node, defaultOverlay()); expect(readPrototypeOverlay(node).issue).toBeUndefined(); expect(node.source.fig.rawNodeFields.overlayPositionType).toBe('FUTURE'); editor.undoAction(); expect(readPrototypeOverlay(node).issue).toContain('preserved');
  for (const offset of [{ x: Infinity, y: 0 }, { x: 0, y: '3' }, { x: 1000001, y: 0 }]) expect(() => setPrototypeInteractions(editor, node, [{ id: 'a', trigger: { type: 'click' }, navigation: { ...action('overlay', node.id), offset } as DesignNavigation }])).toThrow('valid');
});
it('positions overlays against the device viewport or relative to the trigger', () => {
  const viewport = { width: 320, height: 480 }, size = { width: 100, height: 80 }, origin = { x: 30, y: 40 }, offset = { x: -4, y: 12 };
  expect(overlayPosition(defaultOverlay(), viewport, size, origin, offset)).toEqual({ x: 110, y: 200 });
  expect(overlayPosition({ ...defaultOverlay(), position: 'bottom-right' }, viewport, size, origin, offset)).toEqual({ x: 220, y: 400 });
  expect(overlayPosition({ ...defaultOverlay(), position: 'top-center' }, viewport, size, origin, offset)).toEqual({ x: 110, y: 0 });
  expect(overlayPosition({ ...defaultOverlay(), position: 'manual' }, viewport, size, origin, offset)).toEqual({ x: 26, y: 52 });
});
