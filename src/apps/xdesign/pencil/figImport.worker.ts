import { importFigGraphData } from './figImportData';
const worker = self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void };

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const graph = importFigGraphData(event.data);
    const resources = [...graph.images.values(), ...(graph.figSchemaDeflated ? [graph.figSchemaDeflated] : [])];
    const transfer = [...new Set(resources.filter(bytes => bytes.buffer instanceof ArrayBuffer && bytes.byteLength === bytes.buffer.byteLength).map(bytes => bytes.buffer as ArrayBuffer))];
    worker.postMessage({ graph }, transfer);
  }
  catch (error) { worker.postMessage({ error: String(error) }); }
};
