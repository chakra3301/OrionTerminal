import type { Editor } from '@open-pencil/core/editor';

export type CanvasResourceRead = { readonly editor: Editor; readonly token: symbol; readonly check: () => void };
const active = new WeakMap<Editor, CanvasResourceRead>();
export function assertCanvasResourceRead(read: CanvasResourceRead, editor: Editor): void {
  if (read.editor !== editor || active.get(editor) !== read) throw new Error('The image resource operation is no longer active.');
  read.check();
}
export async function withCanvasResourceRead<T>(editor: Editor, check: () => void, work: (read: CanvasResourceRead) => Promise<T>): Promise<T> {
  check();
  if (active.has(editor)) throw new Error('Wait for the current image resource operation to finish.');
  const read = Object.freeze({ editor, token: Symbol('canvas resource read'), check }); active.set(editor, read);
  try { const result = await work(read); assertCanvasResourceRead(read, editor); return result; }
  finally { if (active.get(editor) === read) active.delete(editor); }
}
