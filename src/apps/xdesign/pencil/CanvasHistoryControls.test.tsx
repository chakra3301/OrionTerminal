import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CanvasHistoryControls, performCanvasHistory } from './CanvasHistoryControls';
import type { CanvasRoomSession, RoomUiState } from './roomSession';
import { usePencilWorkspace } from './runtime';
let container: HTMLDivElement, root: Root, editor: Editor;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); editor = createEditor(); usePencilWorkspace.setState({ error: null }); });
afterEach(() => { act(() => root.unmount()); container.remove(); editor.dispose(); vi.unstubAllGlobals(); });
it('enables a viewer comment undo with its label while leaving unavailable artwork redo disabled', async () => {
  const room = { replayHistory: vi.fn(async () => {}) } as unknown as CanvasRoomSession;
  const state = { history: { undoLabel: 'Add comment', redoLabel: 'Move', canUndo: true, canRedo: false, busy: false } } as RoomUiState;
  await act(async () => root.render(<CanvasHistoryControls editor={editor} room={room} state={state} readOnly/>));
  const undo = container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!, redo = container.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
  expect(undo.disabled).toBe(false); expect(undo.title).toContain('Add comment'); expect(redo.disabled).toBe(true); await act(async () => undo.click()); expect(room.replayHistory).toHaveBeenCalledWith('undo');
});
it('uses ordinary native history for a local canvas and reports async room failures through the shared keyboard route', async () => {
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 10 }); editor.updateNodeWithUndo(node.id, { x: 50 }, 'Move');
  await act(async () => root.render(<CanvasHistoryControls editor={editor} room={null} state={null} readOnly={false}/>));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); expect(node.x).toBe(10); performCanvasHistory(editor, null, 'redo'); expect(node.x).toBe(50);
  const room = { replayHistory: vi.fn(async () => { throw new Error('Recover pending comment'); }) } as unknown as CanvasRoomSession; performCanvasHistory(editor, room, 'undo'); await Promise.resolve(); expect(usePencilWorkspace.getState().error).toContain('Recover pending comment'); expect(node.x).toBe(50);
});
