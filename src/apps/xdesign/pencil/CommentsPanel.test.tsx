import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ persist: vi.fn(), project: { activeId: 'comment_project_001', transitioning: false } }));
vi.mock('./runtime', async () => {
  const { create } = await import('zustand');
  const usePencilWorkspace = create<{ editor: Editor | null; busy: boolean; readOnly: boolean }>(() => ({ editor: null, busy: false, readOnly: false }));
  return { usePencilWorkspace, persistPencil: host.persist, assertPencilEditable() { if (usePencilWorkspace.getState().readOnly) throw new Error('Viewer access'); } };
});
vi.mock('../projectsStore', () => ({ useXDProjects: { getState: () => host.project } }));
vi.mock('../photo/runtime', () => ({ usePhotoWorkspace: { getState: () => ({ shapeId: null }) } }));
vi.mock('../useDesignDialog', () => ({ isDesignDialogOpen: () => false }));
import { usePencilWorkspace } from './runtime';
import { CommentsPanel, useCommentController, type CommentController } from './CommentsPanel';
import { addComment, allComments, createCommentAnchor, validCommentAuthor } from './comments';
import type { RoomUiState } from './roomSession';
import type { RoomActor } from './sharedRoomProtocol';
import { roomCommentAccess } from './roomCommentAccess';
import { applyRoomCommentCommand } from './roomCommentCommands';
import type { CanvasRoomSession } from './roomSession';
import type { RoomCommentCommand } from './roomCommentProtocol';
let root: Root, container: HTMLElement, editor: Editor, control: CommentController;
const command = vi.fn(), recover = vi.fn(), discard = vi.fn(), history = vi.fn();
let commandSession: Pick<CanvasRoomSession, 'submitComment' | 'recoverComment' | 'discardComment' | 'loadCommentHistory'> | null;
const actor = { id: 'authenticated_member_001', name: 'Room reviewer', role: 'editor' as const };
function room(phase: 'online' | 'syncing' | 'disconnected' | 'readonly' = 'online', member: RoomActor = actor): RoomUiState {
  return { preference: { documentId: 'comment_document_001', serverUrl: 'https://design.example', revision: 1, role: member.role }, connection: { phase, actor: member, revision: 1, unsent: false, attempt: 0, error: null }, creation: null, opening: false, error: null, presence: null, comments: { phase: 'ready', pending: null, error: null } };
}
function Harness({ shared, state }: { shared: boolean; state: RoomUiState | null }) {
  control = useCommentController(editor, () => {}, () => ({ width: 800, height: 600 }), shared, state, commandSession);
  return <CommentsPanel editor={editor} control={control}/>;
}
function render(shared = false, state: RoomUiState | null = null) { act(() => root.render(<Harness shared={shared} state={state}/>)); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host.persist.mockReset(); command.mockReset(); recover.mockReset(); discard.mockReset(); history.mockReset();
  commandSession = { submitComment: command, recoverComment: recover, discardComment: discard, loadCommentHistory: history };
  command.mockImplementation(async (value: RoomCommentCommand) => { const result = { threadId: 'server_thread', messageId: 'server_message' }; applyRoomCommentCommand(editor.graph, value, actor, result, 1000); return result; }); localStorage.clear(); editor = createEditor(); usePencilWorkspace.setState({ editor, busy: false, readOnly: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); editor.dispose(); container.remove(); vi.unstubAllGlobals(); });
it('uses server commands without editing the local profile or rewriting existing message authors', async () => {
  render(true, room()); const input = container.querySelector('[aria-label="Comment author name"]') as HTMLInputElement;
  expect(input.readOnly).toBe(true); expect(input.value).toBe(actor.name); const originalProfile = localStorage.getItem('orion.xdesign.comment-author');
  act(() => control.place([{ x: 10, y: 20 }])); await act(async () => expect(await control.submit('Room comment')).toBe(true)); expect(command).toHaveBeenCalledOnce(); expect(host.persist).not.toHaveBeenCalled();
  expect(allComments(editor.graph)[0]!.messages[0]!.author).toEqual({ id: actor.id, name: actor.name }); expect(localStorage.getItem('orion.xdesign.comment-author')).toBe(originalProfile);
  render(true, room('online', { ...actor, name: 'Renamed room member' })); expect(allComments(editor.graph)[0]!.messages[0]!.author.name).toBe(actor.name);
});
it('preserves draft positions through disconnect and polling, but cancels them on member changes', async () => {
  render(true, room()); act(() => control.place([{ x: 10, y: 20 }])); const draft = control.draft;
  render(true, room('syncing')); expect(control.draft).toBe(draft);
  render(true, room('disconnected')); expect(control.draft).toBe(draft); expect(control.writable).toBe(false); await act(async () => expect(await control.submit('Lost connection')).toBe(false)); expect(allComments(editor.graph)).toEqual([]);
  render(true, room()); act(() => control.place([{ x: 10, y: 20 }])); render(true, room('online', { ...actor, id: 'different_member_001' })); expect(control.draft).toBeNull();
});
it('keeps local project naming and authoring, but blocks configured disconnected and initializing shared canvases', async () => {
  render(); expect(control.writable).toBe(true); expect((container.querySelector('input') as HTMLInputElement).readOnly).toBe(false);
  act(() => control.place([{ x: 10, y: 20 }])); await act(async () => expect(await control.submit('Local')).toBe(true)); expect(command).not.toHaveBeenCalled(); expect(allComments(editor.graph)[0]!.messages[0]!.author.name).toBe('You');
  render(true, null); expect(control.writable).toBe(false); render(true, { ...room(), connection: null }); expect(control.writable).toBe(false);
  render(true, { ...room(), connection: null, preference: null }); expect(control.writable).toBe(true);
});
it('corrupt local identity cannot block authenticated room comments or read-only comment navigation', async () => {
  localStorage.setItem('orion.xdesign.comment-author', '{bad'); render(true, room()); expect(control.identity?.id).toBe(actor.id); expect(control.error).toBe('');
  act(() => control.place([{ x: 10, y: 20 }])); await act(async () => expect(await control.submit('Authenticated')).toBe(true)); expect(localStorage.getItem('orion.xdesign.comment-author')).toBe('{bad');
  const thread = allComments(editor.graph)[0]!; render(true, { ...room(), connection: null }); await act(async () => control.jump(thread)); expect(control.active).toBe(thread.id); expect(control.error).toBe('');
});
it('a viewer can read, jump and send commands while ordinary artwork callbacks remain blocked', async () => {
  const id = addComment(editor, editor.state.currentPageId, createCommentAnchor(editor.graph, editor.state.currentPageId, [{ x: 10, y: 20 }]), { id: actor.id, name: actor.name }, 'Existing');
  usePencilWorkspace.setState({ readOnly: true }); render(true, room('readonly', { ...actor, role: 'viewer' }));
  await act(async () => control.jump(allComments(editor.graph)[0]!)); expect(control.active).toBe(id); expect(control.writable).toBe(true); expect(container.querySelector('fieldset')!.disabled).toBe(false);
  act(() => expect(control.run(() => { throw new Error('must not run'); })).toBe(false)); expect(allComments(editor.graph)[0]!.messages).toHaveLength(1); expect(host.persist).not.toHaveBeenCalled();
  command.mockImplementation(async (value: RoomCommentCommand) => { const result = { threadId: id, messageId: 'viewer_reply' }; applyRoomCommentCommand(editor.graph, value, { ...actor, role: 'viewer' }, result, 1000); return result; });
  await act(async () => expect(await control.action({ type: 'reply', threadId: id, body: 'Viewer review' })).toBe(true)); expect(allComments(editor.graph)[0]!.messages).toHaveLength(2); expect(usePencilWorkspace.getState().readOnly).toBe(true);
});
it('bounds room identities consistently without splitting Unicode, and pins author scope to access and room', () => {
  expect(validCommentAuthor({ id: actor.id, name: '🙂'.repeat(64) })).toBe(true);
  for (const name of ['x'.repeat(129), '\u0085', '\ud800', '\n']) expect(validCommentAuthor({ id: actor.id, name })).toBe(false);
  const local = { id: 'local_author', name: 'You' }, a = roomCommentAccess(true, room(), local, false);
  expect(a.scope).toBe(roomCommentAccess(true, room('syncing'), local, false).scope); expect(a.scope).toBe(roomCommentAccess(true, room('disconnected'), local, false).scope);
  expect(a.scope).not.toBe(roomCommentAccess(true, { ...room(), preference: { ...room().preference!, documentId: 'different_document_001' } }, local, false).scope);
});
it('keeps the draft and text through a refused submission and exposes recovery without enabling another post', async () => {
  render(true, room()); act(() => control.place([{ x: 10, y: 20 }]));
  const textarea = container.querySelector('[aria-label="New comment"]') as HTMLTextAreaElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this review'); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(textarea.value).toBe('Keep this review');
  const draft = control.draft!; command.mockRejectedValue(new Error('Unknown outcome'));
  await act(async () => { textarea.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'add', body: 'Keep this review' })); expect(control.draft).toBe(draft); expect(control.error).toContain('Unknown outcome'); expect(textarea.value).toBe('Keep this review');
  const next = room(); next.comments = { phase: 'pending', error: 'Unknown outcome', pending: { projectId: '01K00000000000000000000000', serverUrl: 'https://design.example/', actorId: actor.id, packet: { version: 1, type: 'comment', documentId: next.preference!.documentId, clientId: 'comment_client_001', requestId: 'comment_request_001', vector: 'AA==', command: { type: 'add', pageId: draft.pageId, anchor: draft.anchor, body: 'Keep this review' } } } };
  render(true, next); expect(control.draft).toBe(draft); expect(control.blocked).toBe(true); expect(container.querySelector('[aria-label="Pending comment"]')!.textContent).toContain('Keep this review');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Post comment')!.disabled).toBe(true);
  recover.mockResolvedValue({ threadId: 'accepted_thread' }); await act(async () => expect(await control.recover()).toBe(true)); expect(control.active).toBe('accepted_thread'); expect(recover).toHaveBeenCalledOnce();
});
it('does not redirect comment navigation when a late accepted post finishes after choosing another thread', async () => {
  render(true, room()); act(() => control.place([{ x: 10, y: 20 }])); let release!: (value: { threadId: string }) => void; command.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  let work!: Promise<boolean>; act(() => { work = control.submit('Late post'); }); act(() => control.choose('another_thread'));
  await act(async () => { release({ threadId: 'late_thread' }); expect(await work).toBe(false); }); expect(control.active).toBe('another_thread');
});
const historyEntry = { id:101, clientId:'history_client_001', requestId:'history_request_001', threadId:'history_thread', action:'add' as const, undone:false, step:0, revision:2 };
const findButton = (label:string) => [...container.querySelectorAll('button')].find(button => button.textContent === label)!;
async function openHistory() { await act(async()=>{const node=container.querySelector('details.xd-comment-history') as HTMLDetailsElement;node.open=true;node.dispatchEvent(new Event('toggle'));}); }
function historyRoom(undone=false):RoomUiState { return {...room(),commentHistory:{phase:'ready',entries:[{...historyEntry,undone,step:undone?1:0}],next:100,before:null,error:null}}; }
it('loads your history only after disclosure and sends exact undo/redo descriptors through the existing command path', async () => {
  const initial=room();initial.commentHistory={phase:'idle',entries:[],next:null,before:null,error:null};render(true,initial);expect(history).not.toHaveBeenCalled();
  const disclosure=container.querySelector('details.xd-comment-history') as HTMLDetailsElement;
  await act(async()=>{disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));});expect(history).toHaveBeenCalledOnce();
  render(true,historyRoom());command.mockResolvedValue({threadId:historyEntry.threadId});await act(async()=>findButton('Undo add comment').click());expect(command).toHaveBeenLastCalledWith({type:'history',threadId:historyEntry.threadId,sourceClientId:historyEntry.clientId,sourceRequestId:historyEntry.requestId,direction:'undo',step:0});expect(host.persist).not.toHaveBeenCalled();
  render(true,historyRoom(true));await act(async()=>findButton('Redo add comment').click());expect(command).toHaveBeenLastCalledWith(expect.objectContaining({direction:'redo',step:1}));expect(container.textContent).toContain('Undone');
});
it('keeps history paging bounded and offers retry/refresh without enabling actions while loading or pending', async()=>{
  render(true,historyRoom());await openHistory();await act(async()=>findButton('Older actions').click());expect(history).toHaveBeenLastCalledWith(100);
  const next=historyRoom();next.commentHistory={...next.commentHistory!,before:100,next:null};render(true,next);await act(async()=>findButton('Refresh history').click());expect(history).toHaveBeenLastCalledWith(100);await act(async()=>findButton('Latest actions').click());expect(history).toHaveBeenLastCalledWith(undefined);
  next.commentHistory={phase:'loading',entries:[],next:null,before:100,error:null};render(true,next);expect(findButton('Refresh history').disabled).toBe(true);expect(container.textContent).toContain('Loading your comment history');
  next.commentHistory={phase:'error',entries:[],next:null,before:100,error:'History unavailable'};render(true,next);expect(container.querySelector('[role="alert"]')!.textContent).toContain('History unavailable');expect(findButton('Refresh history').disabled).toBe(false);
});
it('exposes interrupted undo recovery while preserving the exact pending action and disabling another history action', async()=>{
  const state=historyRoom();state.comments={phase:'pending',error:'Unknown outcome',pending:{projectId:'01K00000000000000000000000',serverUrl:'https://design.example/',actorId:actor.id,packet:{version:1,type:'comment',documentId:state.preference!.documentId,clientId:'comment_client_001',requestId:'comment_request_001',vector:'AA==',command:{type:'history',threadId:historyEntry.threadId,sourceClientId:historyEntry.clientId,sourceRequestId:historyEntry.requestId,direction:'undo',step:0}}}};render(true,state);await openHistory();expect(findButton('Undo add comment').disabled).toBe(true);expect(container.textContent).toContain('Pending comment undo');recover.mockResolvedValue({threadId:historyEntry.threadId});await act(async()=>findButton('Recover undo').click());expect(recover).toHaveBeenCalledOnce();expect(command).not.toHaveBeenCalled();
});
it('allows viewer history actions, hides local history UI, and ignores late history errors after a member change', async()=>{
  render();expect(container.querySelector('details.xd-comment-history')).toBeNull();const state=historyRoom();state.connection!.actor={...actor,role:'viewer'};usePencilWorkspace.setState({readOnly:true});render(true,state);await openHistory();expect(findButton('Undo add comment').disabled).toBe(false);
  let reject!:(reason:unknown)=>void;history.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));let work!:Promise<boolean>;act(()=>{work=control.loadHistory();});render(true,{...room('online',{...actor,id:'other_member_001'}),commentHistory:{phase:'idle',entries:[],next:null,before:null,error:null}});await act(async()=>{reject(new Error('Late history failure'));expect(await work).toBe(false);});expect(control.error).toBe('');
});
it('clears a history read error after a successful refresh',async()=>{
  render(true,historyRoom());history.mockRejectedValueOnce(new Error('History offline'));await act(async()=>expect(await control.loadHistory()).toBe(false));expect(control.error).toContain('History offline');await act(async()=>expect(await control.loadHistory()).toBe(true));expect(control.error).toBe('');
});
it('does not surface an expected cancellation after disconnecting the same room member',async()=>{
  render(true,historyRoom());let reject!:(reason:unknown)=>void;history.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));let work!:Promise<boolean>;act(()=>{work=control.loadHistory();});render(true,room('disconnected'));await act(async()=>{reject(new DOMException('Cancelled','AbortError'));expect(await work).toBe(false);});expect(control.error).toBe('');
});

it('shows granted original-author actions without relabeling comments and keeps an edit draft when grants disappear', async () => {
  const original = { id: 'legacy_author', name: 'Original' }, pageId = editor.state.currentPageId, threadId = addComment(editor, pageId, createCommentAnchor(editor.graph, pageId, [{ x: 10, y: 20 }]), original, 'Keep attribution');
  const state = room(); state.commentOwnership = { phase: 'ready', authorIds: [original.id], error: null }; render(true, state); act(() => control.choose(threadId)); expect(control.owns(original.id)).toBe(true);
  const edit = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Edit')!; act(() => edit.click()); expect(container.querySelector('[aria-label="Edit comment"]')).not.toBeNull();
  render(true, { ...state, commentOwnership: { phase: 'ready', authorIds: [], error: null } }); expect(control.owns(original.id)).toBe(false); expect([...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Save edit')!.disabled).toBe(true); expect(allComments(editor.graph)[0]!.messages[0]!.author).toEqual(original); expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Edit comment"]')!.value).toBe('Keep attribution');
});
