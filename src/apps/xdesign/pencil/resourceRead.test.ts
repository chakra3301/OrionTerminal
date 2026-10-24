import { expect, it } from 'vitest';
import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import { assertCanvasResourceRead, withCanvasResourceRead, type CanvasResourceRead } from './resourceRead';
function editor() { const graph = new SceneGraph(); return createEditor({ graph, state: createDefaultEditorState(graph.getPages()[0]!.id) }); }
it('refuses concurrent, forged, foreign-editor and expired permissions while allowing a subsequent independent read', async () => {
  const source = editor(), other = editor(); let saved!: CanvasResourceRead;
  try {
    await withCanvasResourceRead(source, () => {}, async read => {
      saved = read; assertCanvasResourceRead(read, source);
      await expect(withCanvasResourceRead(source, () => {}, async () => {})).rejects.toThrow('current');
      expect(() => assertCanvasResourceRead({ ...read }, source)).toThrow('no longer active');
      expect(() => assertCanvasResourceRead(read, other)).toThrow('no longer active');
    });
    expect(() => assertCanvasResourceRead(saved, source)).toThrow('no longer active');
    await withCanvasResourceRead(source, () => {}, async read => expect(read).not.toBe(saved));
  } finally { source.dispose(); other.dispose(); }
});
it('rechecks a changed source after asynchronous work and releases the original slot on failure', async () => {
  const source = editor(); let current = true;
  try {
    await expect(withCanvasResourceRead(source, () => { if (!current) throw new Error('source changed'); }, async read => {
      await Promise.resolve(); current = false; expect(() => assertCanvasResourceRead(read, source)).toThrow('source changed');
    })).rejects.toThrow('source changed');
    current = true; await withCanvasResourceRead(source, () => {}, async () => {});
  } finally { source.dispose(); }
});
it('does not start resource work after an initial source failure and releases a rejected operation', async () => {
  const source = editor(); let started = false;
  try {
    await expect(withCanvasResourceRead(source, () => { throw new Error('closed'); }, async () => { started = true; })).rejects.toThrow('closed'); expect(started).toBe(false);
    await expect(withCanvasResourceRead(source, () => {}, async () => { throw new Error('read failed'); })).rejects.toThrow('read failed');
    await withCanvasResourceRead(source, () => {}, async () => {});
  } finally { source.dispose(); }
});
