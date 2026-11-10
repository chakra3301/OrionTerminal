import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { serializeGraph, deserializeGraph } from './document';
import { PROTOTYPE_PLUGIN, readPrototype, setNavigation } from './prototype';
import { PROTOTYPE_SCROLL, readPrototypeScroll, readScrollBehaviour, scrollTargets, setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import type { DesignScroll } from './reactExportRuntime';
let editor: Editor;
beforeEach(() => { editor = createEditor(); }); afterEach(() => editor.dispose());
const frame = () => editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Scrolling screen' });
it('persists scrolling, initial positions, fixed/sticky layers and local Scroll To through undo and project reopen', () => {
  const owner = frame(), child = editor.graph.createNode('TEXT', owner.id, { name: 'Target', text: 'Target' });
  setPrototypeScroll(editor, owner, { axis: 'both', initial: { x: -12, y: 24 } }); setScrollBehaviour(editor, child, 'sticky');
  setNavigation(editor, owner, { action: 'scroll', target: child.id, offset: { x: 8, y: -4 }, transition: 'scroll', duration: 250 });
  const reopened = deserializeGraph(serializeGraph(editor.graph));
  expect(readPrototypeScroll(reopened.getNode(owner.id)!).settings).toEqual({ axis: 'both', initial: { x: -12, y: 24 } });
  expect(readScrollBehaviour(reopened.getNode(child.id)!, reopened).behaviour).toBe('sticky'); expect(readPrototype(reopened.getNode(owner.id)!).link).toMatchObject({ action: 'scroll', target: child.id, offset: { x: 8, y: -4 } });
  editor.undoAction(); expect(readPrototype(owner).link).toBeUndefined(); editor.undoAction(); expect(readScrollBehaviour(child, editor.graph).behaviour).toBe('scroll'); editor.redoAction(); expect(readScrollBehaviour(child).behaviour).toBe('sticky');
  editor.graph.updateNode(owner.id, { locked: true }); expect(() => setScrollBehaviour(editor, child, 'fixed')).toThrow('Unlock'); expect(() => setPrototypeScroll(editor, owner, { axis: 'none' })).toThrow('Unlock');
});
it('reads native scroll flags and legacy fixed sections without losing opaque data', () => {
  const owner = frame(), normal = editor.graph.createNode('RECTANGLE', owner.id), fixed = editor.graph.createNode('RECTANGLE', owner.id), sticky = editor.graph.createNode('RECTANGLE', owner.id);
  owner.source.fig.rawNodeFields = { scrollDirection: 'BOTH', scrollOffset: { x: 12, y: 40 }, fixedChildrenDivider: 'b' };
  normal.source.orderKey = 'a'; fixed.source.orderKey = 'b'; sticky.source.orderKey = 'c'; fixed.source.fig.rawNodeFields = { scrollBehavior: 'SCROLLS' }; sticky.source.fig.rawNodeFields = { scrollBehavior: 'STICKY_SCROLLS' };
  expect(readPrototypeScroll(owner)).toEqual({ settings: { axis: 'both', initial: { x: 12, y: 40 } }, imported: true });
  expect(readScrollBehaviour(normal, editor.graph).behaviour).toBe('scroll'); expect(readScrollBehaviour(fixed, editor.graph).behaviour).toBe('fixed'); expect(readScrollBehaviour(sticky, editor.graph).behaviour).toBe('sticky');
  setScrollBehaviour(editor, fixed, 'scroll'); expect(readScrollBehaviour(fixed, editor.graph).behaviour).toBe('scroll'); expect(owner.source.fig.rawNodeFields.fixedChildrenDivider).toBe('b');
  editor.undoAction(); expect(readScrollBehaviour(fixed, editor.graph).behaviour).toBe('fixed');
});
it('preserves unsupported imports and repairs settings explicitly, rejecting malformed or unbounded authoring', () => {
  const owner = frame(); owner.source.fig.rawNodeFields = { scrollDirection: 'FUTURE', scrollOffset: { x: 0, y: 0 } };
  expect(readPrototypeScroll(owner).issue).toContain('preserved'); setPrototypeScroll(editor, owner, { axis: 'none' }); expect(readPrototypeScroll(owner).issue).toBeUndefined(); editor.undoAction(); expect(readPrototypeScroll(owner).issue).toContain('preserved');
  for (const value of [null, [], { axis: 'unknown' }, { axis: 'vertical', initial: { x: 0, y: Infinity } }, { axis: 'both', initial: { x: 1000001, y: 0 } }]) expect(() => setPrototypeScroll(editor, owner, value as DesignScroll)).toThrow('valid');
  owner.pluginData = [{ pluginId: PROTOTYPE_PLUGIN, key: PROTOTYPE_SCROLL, value: '{' }]; expect(readPrototypeScroll(owner).issue).toContain('invalid');
  const child = editor.graph.createNode('RECTANGLE', owner.id); child.source.fig.rawNodeFields = { scrollBehavior: 'FUTURE' }; expect(readScrollBehaviour(child).issue).toContain('preserved');
  owner.source.fig.rawNodeFields = { fixedChildrenDivider: 'b' }; child.source.fig.rawNodeFields = {}; expect(readScrollBehaviour(child, editor.graph).issue).toContain('ordering');
});
it('limits Scroll To destinations to visible descendants of the current screen and clears incompatible actions', () => {
  const owner = frame(), nested = editor.graph.createNode('FRAME', owner.id), target = editor.graph.createNode('TEXT', nested.id), other = frame(), hidden = editor.graph.createNode('FRAME', owner.id, { visible: false }); editor.graph.createNode('RECTANGLE', hidden.id);
  expect(scrollTargets(editor.graph, nested).map(node => node.id)).toEqual([nested.id, target.id]);
  const link = { action: 'scroll' as const, target: target.id, transition: 'instant' as const, duration: 0 };
  setNavigation(editor, owner, link); expect(() => setNavigation(editor, owner, { ...link, target: other.id })).toThrow('inside this screen'); expect(() => setNavigation(editor, owner, { ...link, transition: 'slide' })).toThrow('valid'); expect(() => setNavigation(editor, owner, { ...link, resetScroll: true })).toThrow('valid');
  setNavigation(editor, owner, { action: 'navigate', target: other.id, transition: 'instant', duration: 0, preserveScroll: true }); expect(readPrototype(owner).link?.preserveScroll).toBe(true);
  expect(() => setNavigation(editor, owner, { action: 'navigate', target: other.id, transition: 'instant', duration: 0, preserveScroll: true, resetScroll: true })).toThrow('valid');
});
