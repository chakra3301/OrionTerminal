// @vitest-environment node
import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import type { VectorNetwork } from '@open-pencil/scene-graph';
import { cloneDesignSubgraph } from './graphSubset';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { serializeGraph } from './document';

const network = (): VectorNetwork => ({ vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], segments: [0, 1, 2, 3].map(start => ({ start, end: (start + 1) % 4, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })), regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }] });
function fixture(type: 'FRAME' | 'GROUP' = 'FRAME') {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode(type, editor.state.currentPageId, { name: 'Parent', width: 100, height: 80 }), collection = graph.createCollection('Geometry');
  const bind = (id: string, field: string, value: number) => graph.bindVariable(id, field, graph.createVariable(field, 'FLOAT', collection.id, value).id);
  return { editor, graph, root, bind };
}
it('resizes vector paths once in both axes, honors explicit child dimensions and keeps scalar stroke weight', () => {
  const f = fixture();
  try {
    const child = f.graph.createNode('VECTOR', f.root.id, { x: 10, y: 10, width: 20, height: 20, horizontalConstraint: 'STRETCH', vectorNetwork: network(), strokes: [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 3, visible: true, opacity: 1, align: 'OUTSIDE' }] }); f.bind(f.root.id, 'width', 200); f.bind(child.id, 'width', 40); f.bind(child.id, 'height', 10);
    const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph), undefined, { detachResolved: true }); const resized = copy.getNode(child.id)!;
    expect([resized.x, resized.y, resized.width, resized.height]).toEqual([10, 10, 40, 10]); expect(resized.vectorNetwork!.vertices).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }]); expect(resized.strokes[0]!.weight).toBe(3); expect(resized.boundVariables).toEqual({}); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('updates right, center, stretch and scale constraints through nested frame resizing', () => {
  const f = fixture();
  try {
    const modes = ['MAX', 'CENTER', 'STRETCH', 'SCALE'] as const, children = modes.map(horizontalConstraint => f.graph.createNode('FRAME', f.root.id, { name: horizontalConstraint, x: 10, y: 20, width: 20, height: 40, horizontalConstraint, verticalConstraint: 'STRETCH' })), nested = f.graph.createNode('RECTANGLE', children[2]!.id, { x: 5, y: 5, width: 10, height: 10, horizontalConstraint: 'MAX', verticalConstraint: 'MAX' }); f.bind(f.root.id, 'width', 200); f.bind(f.root.id, 'height', 120);
    const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph)); expect(children.map(child => { const node = copy.getNode(child.id)!; return [node.x, node.width, node.y, node.height]; })).toEqual([[110, 20, 20, 80], [60, 20, 20, 80], [10, 120, 20, 80], [20, 40, 20, 80]]); expect(copy.getNode(nested.id)).toMatchObject({ x: 105, y: 45, width: 10, height: 10 });
  } finally { f.editor.dispose(); }
});
it('scales group descendants and cached glyph/path boxes while preserving explicit positions and source bytes', () => {
  const f = fixture('GROUP');
  try {
    const nested = f.graph.createNode('GROUP', f.root.id, { x: 10, y: 20, width: 20, height: 40 }), glyph = f.graph.createNode('VECTOR', nested.id, { x: 3, y: 4, width: 5, height: 6, derivedTextGlyphs: [{ x: 2, y: 3, fontSize: 12, commandsBlob: new Uint8Array([0]) }], textPathBox: { x: 1, y: 2, width: 5, height: 6 } }); f.bind(f.root.id, 'width', 200); f.bind(f.root.id, 'height', 40); f.bind(glyph.id, 'x', 17);
    const before = serializeGraph(f.graph), copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph)); expect(copy.getNode(nested.id)).toMatchObject({ x: 20, y: 10, width: 40, height: 20 }); expect(copy.getNode(glyph.id)).toMatchObject({ x: 17, y: 2, width: 10, height: 3, derivedTextGlyphs: [{ x: 4, y: 1.5, fontSize: 12, scaleX: 2, scaleY: .5 }], textPathBox: { x: 2, y: 1, width: 10, height: 3 } }); expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});
it('enables bound individual corners and borders without losing the unbound uniform values', () => {
  const f = fixture();
  try {
    f.root.cornerRadius = 5; f.root.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, visible: true, opacity: 1, align: 'INSIDE' }]; f.bind(f.root.id, 'topLeftRadius', 12); f.bind(f.root.id, 'borderTopWeight', 6); const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph)); expect(copy.getNode(f.root.id)).toMatchObject({ independentCorners: true, topLeftRadius: 12, topRightRadius: 5, bottomLeftRadius: 5, bottomRightRadius: 5, independentStrokeWeights: true, borderTopWeight: 6, borderRightWeight: 2, borderBottomWeight: 2, borderLeftWeight: 2 });
  } finally { f.editor.dispose(); }
});
it('applies uniform and individual corner/stroke bindings consistently in either insertion order', () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    try {
      f.root.independentCorners = true; f.root.independentStrokeWeights = true; f.root.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, visible: true, opacity: 1, align: 'INSIDE' }]; const fields: [string, number][] = [['cornerRadius', 7], ['topLeftRadius', 11], ['strokeWeight', 4], ['borderTopWeight', 8]]; for (const [field, value] of reverse ? fields.reverse() : fields) f.bind(f.root.id, field, value);
      const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph)); expect(copy.getNode(f.root.id)).toMatchObject({ independentCorners: true, topLeftRadius: 11, topRightRadius: 7, bottomLeftRadius: 7, bottomRightRadius: 7, independentStrokeWeights: true, borderTopWeight: 8, borderRightWeight: 4, borderBottomWeight: 4, borderLeftWeight: 4 });
    } finally { f.editor.dispose(); }
  }
});
it.each(['minWidth', 'maxHeight', 'bottomLeftRadius', 'borderRightWeight', 'gridColumnGap', 'lineHeight', 'fontSize'])('rejects an invalid %s binding before producing a model', field => {
  const f = fixture(); try { f.bind(f.root.id, field, -1); const before = serializeGraph(f.graph); expect(() => materializePrototypeBindings(cloneDesignSubgraph(f.graph, [f.root.id]), capturePrototypeVariables(f.graph))).toThrow('invalid'); expect(serializeGraph(f.graph)).toBe(before); } finally { f.editor.dispose(); }
});
it('rejects contradictory size limits and zero font size, while retaining valid negative positions and letter spacing', () => {
  const f = fixture(); try { f.bind(f.root.id, 'minWidth', 50); f.bind(f.root.id, 'maxWidth', 20); expect(() => materializePrototypeBindings(cloneDesignSubgraph(f.graph, [f.root.id]), capturePrototypeVariables(f.graph))).toThrow('conflicting size limits'); f.root.boundVariables = {}; f.bind(f.root.id, 'fontSize', 0); expect(() => materializePrototypeBindings(cloneDesignSubgraph(f.graph, [f.root.id]), capturePrototypeVariables(f.graph))).toThrow('invalid fontSize'); f.root.boundVariables = {}; f.bind(f.root.id, 'x', -20); f.bind(f.root.id, 'letterSpacing', -1); const copy = cloneDesignSubgraph(f.graph, [f.root.id]); materializePrototypeBindings(copy, capturePrototypeVariables(f.graph)); expect(copy.getNode(f.root.id)).toMatchObject({ x: -20, letterSpacing: -1 }); } finally { f.editor.dispose(); }
});
