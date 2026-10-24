// @vitest-environment node
import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { setNavigation, setPrototypeInteractions } from './prototype';
import { resolveNativeReactScreens } from './nativeReactScreens';
import { serializeGraph } from './graphDocument';

it('captures conditional/sequence routes and destinations authored on nested component definitions without unrelated pages', () => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  try {
    const start = graph.createNode('FRAME', page), next = graph.createNode('FRAME', page), modal = graph.createNode('FRAME', page), unused = graph.createNode('FRAME', page);
    const component = graph.createNode('COMPONENT', page), hotspot = graph.createNode('RECTANGLE', component.id);
    setPrototypeInteractions(editor, hotspot, [{ id: 'flow', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [
      { action: 'conditional', branches: [{ condition: { type: 'literal', value: true }, actions: [{ action: 'navigate', target: next.id, transition: 'instant', duration: 0 }] }, { actions: [{ action: 'overlay', target: modal.id, transition: 'instant', duration: 0 }] }], transition: 'instant', duration: 0 },
    ] } }]);
    graph.createInstance(component.id, start.id);
    const back = graph.createNode('RECTANGLE', next.id); setNavigation(editor, back, { action: 'navigate', target: start.id, transition: 'instant', duration: 0 });
    const before = serializeGraph(graph), ids = resolveNativeReactScreens(graph, start.id);
    expect(new Set(ids)).toEqual(new Set([start.id, next.id, modal.id])); expect(ids).not.toContain(unused.id);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('reports genuinely missing or malformed destinations without deleting their source metadata', () => {
  const editor = createEditor(), graph = editor.graph, start = graph.createNode('FRAME', editor.state.currentPageId), next = graph.createNode('FRAME', editor.state.currentPageId), link = graph.createNode('RECTANGLE', start.id);
  try {
    setNavigation(editor, link, { action: 'navigate', target: next.id, transition: 'instant', duration: 0 }); graph.deleteNode(next.id);
    const before = serializeGraph(graph); expect(() => resolveNativeReactScreens(graph, start.id)).toThrow('destination'); expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});
