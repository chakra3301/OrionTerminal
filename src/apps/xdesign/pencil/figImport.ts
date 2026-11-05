import type { SceneGraph } from '@open-pencil/scene-graph';
import { importFigGraphData, restoreFigGraphData, type FigGraphData } from './figImportData';

export async function parseFigCompatible(buffer: ArrayBuffer): Promise<SceneGraph> {
  if (typeof Worker === 'undefined') return restoreFigGraphData(importFigGraphData(buffer));
  return new Promise<SceneGraph>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./figImport.worker.ts', import.meta.url), { type: 'module' }); }
    catch (error) { reject(new Error(`The design import worker could not start: ${String(error)}`)); return; }
    worker.onmessage = (event: MessageEvent<{ graph?: FigGraphData; error?: string }>) => {
      worker.terminate();
      if (event.data.error || !event.data.graph) reject(new Error(event.data.error ?? 'The design importer returned no graph.'));
      else resolve(restoreFigGraphData(event.data.graph));
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'The design import worker failed.')); };
    try { const copy = buffer.slice(0); worker.postMessage(copy, [copy]); }
    catch (error) { worker.terminate(); reject(error); }
  });
}
