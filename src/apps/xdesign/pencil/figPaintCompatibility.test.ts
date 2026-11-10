import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { importFigGraphData, restoreFigGraphData } from './figImportData';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { deserializeGraph, serializeGraph } from './document';

const figmaMeta = { client_meta: { background_color: { r: .96, g: .96, b: .96, a: 1 }, thumbnail_size: { width: 400, height: 300 }, render_coordinates: { x: 0, y: 0, width: 1200, height: 900 } }, file_name: 'Poster', developer_related_links: [], exported_at: '2024-01-01T00:00:00.000Z' };
async function exportedGraph(): Promise<SceneGraph> {
  const editor = createEditor();
  try { editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Screen' }); return deserializeGraph(serializeGraph(editor.graph)); } finally { editor.dispose(); }
}
const metaOf = async (bytes: Uint8Array) => JSON.parse(await (await JSZip.loadAsync(bytes)).file('meta.json')!.async('string'));
const withFigMeta = (graph: SceneGraph, value: string) => { const root = graph.getNode(graph.rootId)!; root.pluginData = [...root.pluginData, { pluginId: 'open-pencil', key: 'figMeta', value }]; return graph; };

it('export restores client_meta and file_name from the imported meta', async () => {
  const zip = await JSZip.loadAsync(await exportFigImageCompatible(await exportedGraph())); zip.file('meta.json', JSON.stringify(figmaMeta));
  const imported = deserializeGraph(serializeGraph(restoreFigGraphData(importFigGraphData(await zip.generateAsync({ type: 'arraybuffer' })))));
  const meta = await metaOf(await exportFigImageCompatible(imported));
  expect(meta.client_meta).toEqual(figmaMeta.client_meta); expect(meta.file_name).toBe('Poster');
  expect(meta.exported_at).not.toBe(figmaMeta.exported_at); expect(Number.isNaN(Date.parse(meta.exported_at))).toBe(false);
});
it('invalid stored meta keeps the stub', async () => {
  for (const value of ['{not json', '[1]', 'null']) expect((await metaOf(await exportFigImageCompatible(withFigMeta(await exportedGraph(), value)))).app).toBe('OpenPencil');
});
it('figMeta pluginData is not written into canvas.fig', async () => {
  const bytes = await exportFigImageCompatible(withFigMeta(await exportedGraph(), JSON.stringify(figmaMeta)));
  const document = parseFigBuffer(new Uint8Array(bytes).buffer).nodeChanges.find(node => node.type === 'DOCUMENT')!;
  expect((document.pluginData ?? []).some(entry => entry.key === 'figMeta')).toBe(false);
});
