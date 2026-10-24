import { afterEach, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { parseFigCompatible } from './figImport';
import { importFigGraphData } from './figImportData';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { deserializeGraph, serializeGraph } from './document';
afterEach(() => vi.unstubAllGlobals());
it('transfers one input copy, restores a functioning graph and terminates the worker', async () => {
  const editor = createEditor();
  try {
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Worker screen' });
    const bytes = await exportFigImageCompatible(deserializeGraph(serializeGraph(editor.graph))), input = new Uint8Array(bytes).buffer;
    const terminate = vi.fn(), post = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage!: (event: { data: unknown }) => void;
      terminate = terminate;
      constructor(url: URL, options: WorkerOptions) { expect(url.pathname).toContain('figImport.worker'); expect(options.type).toBe('module'); }
      postMessage(buffer: ArrayBuffer, transfer: Transferable[]) {
        post(); expect(buffer).not.toBe(input); expect(transfer).toEqual([buffer]);
        queueMicrotask(() => this.onmessage({ data: structuredClone({ graph: importFigGraphData(buffer) }) }));
      }
    });
    const graph = await parseFigCompatible(input), screen = [...graph.nodes.values()].find(node => node.name === frame.name)!;
    expect(graph.getChildren(screen.parentId!)).toContain(screen); graph.createNode('TEXT', screen.id, { text: 'Editable' });
    expect(terminate).toHaveBeenCalledOnce(); expect(post).toHaveBeenCalledOnce(); expect(input.byteLength).toBe(bytes.byteLength);
  } finally { editor.dispose(); }
});
it('terminates failed workers and reports decoding or startup failure explicitly', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { onmessage!: (event: { data: unknown }) => void; terminate = terminate; postMessage() { queueMicrotask(() => this.onmessage({ data: { error: 'Invalid archive' } })); } });
  await expect(parseFigCompatible(new ArrayBuffer(1))).rejects.toThrow('Invalid archive'); expect(terminate).toHaveBeenCalledOnce();
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked'); } });
  await expect(parseFigCompatible(new ArrayBuffer(1))).rejects.toThrow('Worker blocked');
});
