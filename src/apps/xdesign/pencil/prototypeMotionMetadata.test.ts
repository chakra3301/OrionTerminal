import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { scaleGeometryPaths } from '@open-pencil/scene-graph';
import { prototypeMotionMetadata } from './prototypeMotionMetadata';
import { selectionToDesignModel } from './reactExport';
import { serializeGraph } from './document';
import { smartPoint } from './prototypeSmartGeometry';
import { smartLayerPairs } from './prototypeSmartMatching';
it('exports independent native shape/paint/local geometry without changing document identity or source data', () => {
  const editor = createEditor();
  try {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Root', x: 500, y: 400, width: 320, height: 480 }), rectangle = graph.createNode('RECTANGLE', frame.id, { name: 'Card', x: 20, y: 30, width: 100, height: 50, rotation: 90, opacity: 0.4, cornerRadius: 12, fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0, a: 0.75 }, opacity: 0.6, visible: true }] });
    const before = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id], undefined, true), root = model.nodes[0]!, card = root.children[0]!;
    expect(root.motion).toMatchObject({ version: 1, root: true, width: 320, height: 480, local: [1, 0, 0, 1, 0, 0] });
    expect(card.motion).toMatchObject({ type: 'RECTANGLE', shadow: false, radii: [12, 12, 12, 12], paints: [{ type: 'SOLID', color: [1, 0.5, 0, 0.75], opacity: 0.6, blend: 'NORMAL' }] });
    const corner = smartPoint(card.motion!.local, 0, 0); expect(corner[0]).toBeCloseTo(95); expect(corner[1]).toBeCloseTo(5); expect(serializeGraph(graph)).toBe(before); expect(graph.getNode(rectangle.id)).toBe(rectangle);
    card.motion!.paints[0]!.color[0] = 0; expect(rectangle.fills[0]!.color.r).toBe(1);
  } finally { editor.dispose(); }
});
it('normalizes native vector and binary path coordinates across resize while distinguishing changed geometry', () => {
  const editor = createEditor();
  try {
    const graph = editor.graph, a = graph.createNode('VECTOR', editor.state.currentPageId, { width: 100, height: 200, vectorNetwork: { vertices: [{ x: 10, y: 20 }, { x: 80, y: 160 }], segments: [{ start: 0, end: 1, tangentStart: { x: 10, y: 20 }, tangentEnd: { x: -10, y: -20 } }], regions: [] } }), b = graph.createNode('VECTOR', editor.state.currentPageId, { width: 200, height: 100, vectorNetwork: { vertices: [{ x: 20, y: 10 }, { x: 160, y: 80 }], segments: [{ start: 0, end: 1, tangentStart: { x: 20, y: 10 }, tangentEnd: { x: -20, y: -10 } }], regions: [] } });
    const blob = new Uint8Array(10), view = new DataView(blob.buffer); blob[0] = 1; view.setFloat32(1, 10, true); view.setFloat32(5, 20, true); blob[9] = 0; a.fillGeometry = [{ commandsBlob: blob, windingRule: 'NONZERO' }]; b.fillGeometry = scaleGeometryPaths(a.fillGeometry, 2, 0.5);
    const before = serializeGraph(graph); expect(prototypeMotionMetadata(a, false).shape).toBe(prototypeMotionMetadata(b, false).shape); expect(serializeGraph(graph)).toBe(before);
    b.vectorNetwork!.vertices[1]!.x += 5; expect(prototypeMotionMetadata(a, false).shape).not.toBe(prototypeMotionMetadata(b, false).shape);
    a.fillGeometry = [{ commandsBlob: new Uint8Array([255, 1, 2]), windingRule: 'NONZERO' }]; expect(JSON.parse(prototypeMotionMetadata(a, false).shape).fill).toEqual([{ winding: 'NONZERO', opaque: [255, 1, 2] }]);
  } finally { editor.dispose(); }
});
it('retains gradient/image paint transport, excludes hidden fills and distinguishes shadows from blur', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 0.5, color: { r: 0, g: 0, b: 0, a: 1 }, gradientTransform: { m00: 1, m10: 0.5, m01: 0, m11: 1, m02: 0.2, m12: -0.3 }, gradientStops: [{ position: 0.2, color: { r: 1, g: 0, b: 0, a: 0.5 } }] }, { type: 'IMAGE', visible: true, opacity: 0.75, color: { r: 1, g: 1, b: 1, a: 1 }, imageHash: 'resource', imageScaleMode: 'FIT' }, { type: 'SOLID', visible: false, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }] });
    const effect = { color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 5, spread: 0, visible: true };
    expect(prototypeMotionMetadata(node, false).paints).toEqual([{ type: 'GRADIENT_LINEAR', color: [0, 0, 0, 1], opacity: 0.5, blend: 'NORMAL', transform: [1, 0.5, 0, 1, 0.2, -0.3], stops: [{ position: 0.2, color: [1, 0, 0, 0.5] }] }, { type: 'IMAGE', color: [1, 1, 1, 1], opacity: 0.75, blend: 'NORMAL', image: 'resource', scaleMode: 'FIT' }]);
    node.effects = [{ ...effect, type: 'LAYER_BLUR' }]; expect(prototypeMotionMetadata(node, false).shadow).toBe(false); node.effects = [{ ...effect, type: 'DROP_SHADOW' }]; expect(prototypeMotionMetadata(node, false).shadow).toBe(true);
  } finally { editor.dispose(); }
});
it('matches actual independently authored exported screens and marks native changed shapes for dissolve', () => {
  const editor = createEditor();
  try {
    const graph = editor.graph, home = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Home' }), details = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Details' });
    graph.createNode('RECTANGLE', home.id, { name: 'Card', x: 10, width: 100, height: 50 }); graph.createNode('RECTANGLE', details.id, { name: 'Card', x: 200, width: 200, height: 100 }); graph.createNode('ELLIPSE', home.id, { name: 'Shape' }); graph.createNode('RECTANGLE', details.id, { name: 'Shape' });
    const a = selectionToDesignModel(graph, [home.id]).nodes[0]!, b = selectionToDesignModel(graph, [details.id]).nodes[0]!; expect(smartLayerPairs(a, b).children.map(pair => pair.reason)).toEqual(['match', 'type']);
  } finally { editor.dispose(); }
});
