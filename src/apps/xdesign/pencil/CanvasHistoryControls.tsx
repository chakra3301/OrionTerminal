import { Undo2, Redo2 } from 'lucide-react';
import type { Editor } from '@open-pencil/core/editor';
import type { CanvasRoomSession, RoomUiState } from './roomSession';
import { usePencilWorkspace } from './runtime';

export function performCanvasHistory(editor: Editor, room: CanvasRoomSession | null, direction: 'undo' | 'redo'): void {
  try {
    if (room) void room.replayHistory(direction).catch(error => usePencilWorkspace.setState({ error: String(error) }));
    else editor[direction === 'undo' ? 'undoAction' : 'redoAction']();
  } catch (error) { usePencilWorkspace.setState({ error: String(error) }); }
}
export function CanvasHistoryControls({ editor, room, state, readOnly }: { editor: Editor | null; room: CanvasRoomSession | null; state: RoomUiState | null; readOnly: boolean }) {
  return <div className="xd-editor-history">{(['undo', 'redo'] as const).map(direction => {
    const redo = direction === 'redo', verb = redo ? 'Redo' : 'Undo';
    const label = room ? state?.history?.[redo ? 'redoLabel' : 'undoLabel'] : editor?.undo[redo ? 'redoLabel' : 'undoLabel'];
    const enabled = editor && (room ? state?.history?.[redo ? 'canRedo' : 'canUndo'] : !readOnly && editor.undo[redo ? 'canRedo' : 'canUndo']);
    return <button key={direction} className="xd-editor-icon-button" aria-label={verb} title={`${verb}${label ? ` ${label}` : ''} (${redo ? '⇧⌘Z' : '⌘Z'})`} disabled={!enabled} onClick={() => editor && performCanvasHistory(editor, room, direction)}>{redo ? <Redo2 size={16}/> : <Undo2 size={16}/>}</button>;
  })}</div>;
}
