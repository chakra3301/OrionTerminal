import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@open-pencil/core/editor';
import { getWorldMatrix, TransformMatrix, type Vector } from '@open-pencil/scene-graph';
import { usePencilWorkspace, persistPencil, assertPencilEditable } from './runtime';
import { useXDProjects } from '../projectsStore';
import { usePhotoWorkspace } from '../photo/runtime';
import { isDesignDialogOpen } from '../useDesignDialog';
import { commentIdentity, renameCommentIdentity } from './commentIdentity';
import { roomCommentAccess } from './roomCommentAccess';
import type { CanvasRoomSession, RoomUiState } from './roomSession';
import { readRoomCommentCommand, type RoomCommentCommand } from './roomCommentProtocol';
import { COMMENT_REACTIONS, addComment, allComments, createCommentAnchor, deleteCommentMessage, editCommentMessage, moveComment, reactToComment, replyToComment, resolveComment, resolveCommentAnchor, type CommentAnchor, type CommentAuthor, type LocatedComment } from './comments';

export function useCommentController(editor: Editor | null, open: () => void, viewport: () => { width: number; height: number }, shared = false, room: RoomUiState | null = null, session: (Pick<CanvasRoomSession, 'submitComment' | 'recoverComment' | 'discardComment'> & Partial<Pick<CanvasRoomSession, 'loadCommentHistory' | 'loadCommentOwnership'>>) | null = null) {
  const [mode, setMode] = useState(false), [active, setActive] = useState<string | null>(null), [draft, setDraft] = useState<{ editor: Editor; graph: Editor['graph']; projectId: string | null; pageId: string; anchor: CommentAnchor; authorScope: string } | null>(null), [moving, setMoving] = useState<string | null>(null), [error, setError] = useState('');
  const [localIdentity, setIdentity] = useState<CommentAuthor | null>(null), [localError, setLocalError] = useState('');
  useEffect(() => { setMode(false); setActive(null); setDraft(null); setMoving(null); setError(''); setSending(false); inFlight.current = false; intent.current++; }, [editor]);
  useEffect(() => { try { setIdentity(commentIdentity()); } catch (error) { setLocalError(String(error)); } }, []);
  const page = editor?.state.currentPageId;
  const readOnly = usePencilWorkspace(state => state.readOnly);
  const access = roomCommentAccess(shared, room, localIdentity, readOnly, !!session), latestAccess = useRef(access); latestAccess.current = access;
  const [sending, setSending] = useState(false), inFlight = useRef(false), alive = useRef(true), source = useRef(editor); source.current = editor;
  const intent = useRef(0), operation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pending = room?.comments?.pending ?? null;
  const blocked = sending || !!session && shared && (!room?.comments || room.comments.phase !== 'ready');
  const identity = access.author;
  const owns = (authorId: string) => !!identity && (authorId === identity.id || access.configured && room?.commentOwnership?.phase === 'ready' && room.commentOwnership.authorIds.includes(authorId));
  useEffect(() => { setMode(false); setDraft(null); setMoving(null); }, [access.scope]);
  useEffect(() => { intent.current++; setDraft(null); setMoving(null); }, [page]);
  function guard(): Editor {
    if (!editor || usePencilWorkspace.getState().editor !== editor || usePencilWorkspace.getState().busy || editor.isInteractiveEditing() || useXDProjects.getState().transitioning || usePhotoWorkspace.getState().shapeId || isDesignDialogOpen()) throw new Error('Wait for the active Design canvas before editing comments.');
    return editor;
  }
  function prepare(work: (editor: Editor, author: CommentAuthor) => void): boolean {
    try { const current = guard(), access = latestAccess.current; if (!access.writable || !access.author) throw new Error(access.reason); if (blocked || inFlight.current) throw new Error('Recover or discard the pending comment before continuing.'); work(current, access.author); setError(''); return true; } catch (error) { setError(String(error)); return false; }
  }
  function run(work: (editor: Editor, author: CommentAuthor) => void): boolean {
    return prepare((current, author) => { if (latestAccess.current.configured) throw new Error('Send room comments through the comment commands.'); assertPencilEditable(); work(current, author); });
  }
  async function action(value: RoomCommentCommand): Promise<boolean> {
    let current: Editor, projectId: string | null, scope: string;
    try { current = guard(); projectId = useXDProjects.getState().activeId; scope = latestAccess.current.scope; if (blocked || inFlight.current) throw new Error('Recover or discard the pending comment before continuing.'); if (!latestAccess.current.writable || !latestAccess.current.author) throw new Error(latestAccess.current.reason); }
    catch (error) { setError(String(error)); return false; }
    const valid = () => alive.current && source.current === current && usePencilWorkspace.getState().editor === current && useXDProjects.getState().activeId === projectId && latestAccess.current.scope === scope;
    const ticket = intent.current, op = ++operation.current;
    inFlight.current = true; setSending(true);
    try {
      const command = readRoomCommentCommand(value); let id: string | undefined;
      if (latestAccess.current.configured) {
        if (!session) throw new Error('Connect room comments before posting.');
        id = (await session.submitComment(command)).threadId;
      } else {
        assertPencilEditable(); const author = latestAccess.current.author!;
        switch (command.type) {
          case 'add': id = addComment(current, command.pageId, command.anchor, author, command.body, persistPencil); break;
          case 'reply': replyToComment(current, command.threadId, author, command.body, persistPencil); break;
          case 'edit': editCommentMessage(current, command.threadId, command.messageId, author, command.body, persistPencil); break;
          case 'delete': deleteCommentMessage(current, command.threadId, command.messageId, author, persistPencil); break;
          case 'resolve': resolveComment(current, command.threadId, command.resolved, author, persistPencil); break;
          case 'move': moveComment(current, command.threadId, command.anchor, author, persistPencil); break;
          case 'react': reactToComment(current, command.threadId, command.messageId, command.emoji, author, persistPencil); break;
          case 'history': throw new Error('Use local comment history for an unconnected project.');
        }
      }
      if (!valid() || intent.current !== ticket) return false;
      if (command.type === 'add') { setDraft(null); setActive(id!); setMode(false); }
      if (command.type === 'move') { setMoving(null); setMode(false); }
      setError(''); return true;
    } catch (error) { if (valid()) setError(String(error)); return false; }
    finally { if (operation.current === op) { inFlight.current = false; if (alive.current && source.current === current) setSending(false); } }
  }
  async function recover(): Promise<boolean> {
    if (!session || inFlight.current) return false;
    const current = editor, project = useXDProjects.getState().activeId, ticket = intent.current, op = ++operation.current; inFlight.current = true; setSending(true);
    try { const result = await session.recoverComment(); if (!alive.current || source.current !== current || useXDProjects.getState().activeId !== project || ticket !== intent.current) return false; setDraft(null); setMoving(null); setMode(false); setActive(result.threadId); setError(''); return true; }
    catch (error) { if (alive.current && source.current === current) setError(String(error)); return false; }
    finally { if (operation.current === op) { inFlight.current = false; if (alive.current && source.current === current) setSending(false); } }
  }
  async function discard(): Promise<void> {
    if (!session || inFlight.current) return;
    const current = editor, op = ++operation.current; inFlight.current = true; setSending(true);
    try { await session.discardComment(); if (alive.current && source.current === current) setError(''); }
    catch (error) { if (alive.current && source.current === current) setError(String(error)); }
    finally { if (operation.current === op) { inFlight.current = false; if (alive.current && source.current === current) setSending(false); } }
  }
  async function loadHistory(before?: number): Promise<boolean> {
    const current = editor, scope = latestAccess.current.scope, projectId = useXDProjects.getState().activeId, op = operation.current;
    const valid = () => alive.current && source.current === current && useXDProjects.getState().activeId === projectId && latestAccess.current.scope === scope && operation.current === op;
    try {
      guard(); if (!latestAccess.current.configured || !latestAccess.current.writable || !session?.loadCommentHistory) throw new Error('Connect the room before opening your comment history.');
      if (inFlight.current) throw new Error('Wait for the comment to finish before loading history.');
      await session.loadCommentHistory(before);
      if (!valid()) return false; setError(''); return true;
    } catch (error) { if (valid() && !(error instanceof DOMException && error.name === 'AbortError')) setError(String(error)); return false; }
  }
  async function loadOwnership(): Promise<boolean> {
    const current = editor, scope = latestAccess.current.scope, project = useXDProjects.getState().activeId;
    try { guard(); if (!session?.loadCommentOwnership || !latestAccess.current.configured) throw new Error('Connect the room before refreshing comment access.'); await session.loadCommentOwnership(); if (!alive.current || source.current !== current || useXDProjects.getState().activeId !== project || latestAccess.current.scope !== scope) return false; setError(''); return true; }
    catch (error) { if (alive.current && source.current === current && !(error instanceof DOMException && error.name === 'AbortError')) setError(String(error)); return false; }
  }
  const choose = (id: string) => { intent.current++; setActive(id); setDraft(null); setMoving(null); open(); };
  function place(points: Vector[], targetId?: string) {
    prepare(current => {
      const anchor = createCommentAnchor(current.graph, current.state.currentPageId, points, targetId);
      if (moving) { void action({ type: 'move', threadId: moving, pageId: current.state.currentPageId, anchor }); }
      else { setDraft({ editor: current, graph: current.graph, projectId: useXDProjects.getState().activeId, pageId: current.state.currentPageId, anchor, authorScope: latestAccess.current.scope }); setActive(null); }
      open();
    });
  }
  function beginMove(id: string) { prepare(current => { const thread = allComments(current.graph).find(thread => thread.id === id); if (!thread || !owns(thread.messages[0]!.author.id)) throw new Error('Refresh comment access before moving this original author’s pin.'); setMoving(id); setDraft(null); setMode(true); open(); }); }
  function toggle() { if (mode) { cancel(); return; } prepare(current => { current.commitTextEdit(); current.setTool('SELECT'); setMode(true); setDraft(null); setMoving(null); open(); }); }
  function cancel() { intent.current++; setDraft(null); setMoving(null); setMode(false); setError(''); }
  async function jump(thread: LocatedComment) {
    try {
      const current = guard(), graph = current.graph, projectId = useXDProjects.getState().activeId, anchor = resolveCommentAnchor(current.graph, thread);
      if (current.state.currentPageId !== anchor.pageId) await current.switchPage(anchor.pageId);
      if (guard() !== current || current.graph !== graph || useXDProjects.getState().activeId !== projectId) throw new Error('The project changed while opening this comment.');
      const xs = anchor.points.map(point => point.x), ys = anchor.points.map(point => point.y);
      current.zoomToBounds(Math.min(...xs) - 40, Math.min(...ys) - 40, Math.max(...xs) + 40, Math.max(...ys) + 40); choose(thread.id);
    } catch (error) { setError(String(error)); }
  }
  return { owns, ownership: room?.commentOwnership ?? null, ownershipAvailable: !!session?.loadCommentOwnership, loadOwnership, mode, active, draft, moving, error: error || room?.comments?.error || (!access.configured ? localError : ''), identity, configured: access.configured, writable: access.writable, blocked, sending: sending || room?.comments?.phase === 'sending', pending, history: room?.commentHistory ?? null, historyAvailable: !!session?.loadCommentHistory, loadHistory, accessReason: access.reason, setIdentity, setError, run, action, recover, discard, choose, place, beginMove, toggle, cancel, jump, viewport, async submit(body: string): Promise<boolean> {
    try { const current = guard(); if (!draft || draft.authorScope !== latestAccess.current.scope || draft.editor !== current || draft.graph !== current.graph || draft.projectId !== useXDProjects.getState().activeId || draft.pageId !== current.state.currentPageId) throw new Error('The comment position or author changed. Choose it again.'); return action({ type: 'add', pageId: draft.pageId, anchor: draft.anchor, body }); }
    catch (error) { setError(String(error)); return false; }
  } };
}
export type CommentController = ReturnType<typeof useCommentController>;
function read(editor: Editor | null) { try { return { threads: editor ? allComments(editor.graph) : [], error: '' }; } catch (error) { return { threads: [], error: String(error) }; } }

export function CommentsPanel({ editor, control }: { editor: Editor; control: CommentController }) {
  const readOnly = !control.writable || control.blocked;
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open'), [scope, setScope] = useState<'page' | 'file'>('page'), [search, setSearch] = useState(''), [body, setBody] = useState(''), [editId, setEditId] = useState<string | null>(null), [editBody, setEditBody] = useState(''), [deleting, setDeleting] = useState<string | null>(null);
  const { threads, error } = read(editor), active = threads.find(thread => thread.id === control.active), numbers = new Map(threads.map((thread, index) => [thread.id, index + 1]));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [discarding, setDiscarding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = control.history, pendingHistory = control.pending?.packet.command.type === 'history' ? control.pending.packet.command : null;
  useEffect(() => { setHistoryOpen(false); }, [editor, control.identity?.id, control.configured]);
  useEffect(() => { if (historyOpen && history?.phase === 'idle' && control.writable && !control.blocked) void control.loadHistory(); }, [historyOpen, history?.phase, control.writable, control.blocked]);
  useEffect(() => { setBody(''); setEditId(null); setDeleting(null); }, [control.active, editor]);
  useEffect(() => { setEditId(null); setDeleting(null); }, [control.draft]);
  useEffect(() => { setDiscarding(false); }, [control.pending?.packet.requestId]);
  useEffect(() => { if (control.draft) textarea.current?.focus(); }, [control.draft]);
  const visible = threads.filter(thread => (filter === 'all' || thread.resolved === (filter === 'resolved')) && (scope === 'file' || resolveCommentAnchor(editor.graph, thread).pageId === editor.state.currentPageId) && thread.messages.some(message => `${message.body} ${message.author.name}`.toLowerCase().includes(search.toLowerCase())));
  function selection() {
    const node = editor.getSelectedNodes()[0];
    if (node) control.place([TransformMatrix.mapPoint(getWorldMatrix(node, editor.graph), { x: node.width / 2, y: node.height / 2 })], node.id);
    else { const size = control.viewport(); control.place([editor.screenToCanvas(size.width / 2, size.height / 2)]); }
  }
  return <div className="xd-comments-panel">
    <header><strong>Comments</strong><small>{control.configured ? 'Shared with this room' : 'Saved in this project'}</small></header>
    {control.identity && <label>{control.configured ? 'Room member' : 'Your name'}<input aria-label="Comment author name" readOnly={control.configured} key={control.identity.name} defaultValue={control.identity.name} maxLength={128} onBlur={event => { if (control.configured) return; try { control.setIdentity(renameCommentIdentity(control.identity!, event.target.value)); } catch (error) { control.setError(String(error)); } }}/></label>}
    {control.configured && control.ownershipAvailable && <div className="xd-pencil-buttons"><button disabled={!control.writable || control.sending || control.ownership?.phase === 'loading'} onClick={() => void control.loadOwnership()}>{control.ownership?.phase === 'loading' ? 'Loading comment access…' : 'Refresh comment access'}</button></div>}
    {control.ownership?.error && <p role="alert">{control.ownership.error}</p>}
    {control.accessReason && <p role="status">{control.accessReason}</p>}
    {control.sending && <p role="status">Sending comment…</p>}
    {control.pending && <section className="xd-pencil-property-card" aria-label="Pending comment"><strong>{pendingHistory ? `Pending comment ${pendingHistory.direction}` : 'Pending comment'}</strong>{'body' in control.pending.packet.command && <p>{control.pending.packet.command.body}</p>}<p>The reply was not confirmed. Recover this request before posting another.</p><div className="xd-pencil-buttons"><button disabled={!control.writable || control.sending} onClick={() => void control.recover()}>{pendingHistory ? `Recover ${pendingHistory.direction}` : 'Recover comment'}</button>{discarding ? <><p>An accepted comment may still appear. Discarding this request does not delete it.</p><button disabled={control.sending} onClick={() => void control.discard().then(() => setDiscarding(false))}>Confirm discard</button><button disabled={control.sending} onClick={() => setDiscarding(false)}>Keep request</button></> : <button disabled={control.sending} onClick={() => setDiscarding(true)}>Discard request</button>}</div></section>}
    <div className="xd-pencil-buttons"><button disabled={readOnly} aria-pressed={control.mode} onClick={control.toggle}>{control.mode ? 'Stop placing' : 'Pin on canvas'}</button><button disabled={readOnly || !control.identity || !!error} onClick={selection}>{editor.state.selectedIds.size ? 'Comment on selection' : 'Comment at view center'}</button></div>
    {control.mode && <p role="status">{control.moving ? 'Click or drag to move this comment.' : 'Click to pin a comment, or drag to mark a region.'} Escape cancels.</p>}
    {(error || control.error) && <p role="alert">{error || control.error}</p>}
    {control.configured && control.historyAvailable && <details className="xd-pencil-property-card xd-comment-history" open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>Your comment history</summary>
      <div className="xd-pencil-buttons"><button disabled={readOnly || history?.phase === 'loading'} onClick={() => void control.loadHistory(history?.before ?? undefined)}>Refresh history</button>{history?.before !== null && history?.before !== undefined && <button disabled={readOnly || history.phase === 'loading'} onClick={() => void control.loadHistory()}>Latest actions</button>}</div>
      {history?.phase === 'loading' && <p role="status">Loading your comment history…</p>}{history?.error && <p role="alert">{history.error}</p>}
      {history?.phase === 'ready' && <><ol className="xd-comment-history-list" aria-label="Your comment actions">{history.entries.map(entry => {
        const label = ({ add: 'Add comment', reply: 'Reply', edit: 'Edit comment', delete: 'Delete comment', resolve: 'Change resolution', move: 'Move pin', react: 'Reaction' })[entry.action], thread = threads.find(thread => thread.id === entry.threadId), verb = entry.undone ? 'Redo' : 'Undo';
        return <li key={entry.id}><strong>{label}</strong><small>{entry.undone ? 'Undone' : 'Applied'}</small><p>{thread?.messages[0]?.body ?? 'Comment unavailable'}</p><div className="xd-pencil-buttons"><button disabled={readOnly} onClick={() => void control.action({ type: 'history', threadId: entry.threadId, sourceClientId: entry.clientId, sourceRequestId: entry.requestId, direction: entry.undone ? 'redo' : 'undo', step: entry.step }).then(ok => { if (ok) { setEditId(null); setDeleting(null); } })}>{verb} {label.toLowerCase()}</button>{thread && <button onClick={() => void control.jump(thread)}>Open comment</button>}</div></li>;
      })}</ol>{!history.entries.length && <p>No recorded comment actions for this room member.</p>}{history.next !== null && <button disabled={readOnly} onClick={() => void control.loadHistory(history.next!)}>Older actions</button>}</>}
    </details>}
    <input aria-label="Search comments" placeholder="Search comments and authors" value={search} onChange={event => setSearch(event.target.value)}/>
    <div className="xd-comments-filters"><select aria-label="Comment status" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All comments</option></select><select aria-label="Comment pages" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="page">This page</option><option value="file">Whole file</option></select></div>
    {control.draft && <form className="xd-pencil-property-card" onSubmit={event => { event.preventDefault(); void control.submit(body).then(ok => { if (ok) setBody(''); }); }}><strong>New comment</strong><textarea ref={textarea} aria-label="New comment" readOnly={control.sending} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); control.cancel(); } }} maxLength={8192} value={body} onChange={event => setBody(event.target.value)}/><div className="xd-pencil-buttons"><button type="submit" disabled={readOnly || !body.trim() || !!error}>Post comment</button><button type="button" disabled={control.sending} onClick={control.cancel}>Cancel</button></div></form>}
    <div className="xd-comments-list" aria-label="Comment threads">{!visible.length && <p>No {filter === 'all' ? '' : filter + ' '}comments{search ? ' match your search' : ' on this page'}.</p>}{visible.map(thread => <button className={control.active === thread.id ? 'selected' : ''} key={thread.id} aria-pressed={control.active === thread.id} onClick={() => void control.jump(thread)}><strong>{numbers.get(thread.id)} · {thread.messages[0]!.author.name}</strong><span>{thread.messages[0]!.body}</span><small>{thread.messages.length - 1} replies{thread.resolved ? ' · Resolved' : ''}{resolveCommentAnchor(editor.graph, thread).missingTarget ? ' · Original layer unavailable' : ''}</small></button>)}</div>
    {active && <section className="xd-comments-thread" aria-label="Selected comment thread"><header><strong>{active.resolved ? 'Resolved comment' : 'Comment thread'}</strong><button disabled={readOnly} onClick={() => void control.action({ type: 'resolve', threadId: active.id, resolved: !active.resolved })}>{active.resolved ? 'Reopen' : 'Resolve'}</button></header>
      <fieldset className="xd-pencil-edit-fields" disabled={readOnly}>{active.messages.map((message, index) => <article key={message.id}><header><strong>{message.author.name}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString()}</time></header>{message.editedAt && <small>Edited</small>}{editId === message.id ? <form onSubmit={event => { event.preventDefault(); void control.action({ type: 'edit', threadId: active.id, messageId: message.id, body: editBody }).then(ok => { if (ok) setEditId(null); }); }}><textarea aria-label="Edit comment" value={editBody} maxLength={8192} onChange={event => setEditBody(event.target.value)}/><div className="xd-pencil-buttons"><button type="submit" disabled={!editBody.trim() || !control.owns(message.author.id)}>Save edit</button><button type="button" onClick={() => setEditId(null)}>Cancel edit</button></div></form> : <p>{message.body}</p>}
        <div className="xd-comments-reactions">{message.reactions.map(reaction => <button key={reaction.emoji} aria-label={`React ${reaction.emoji}`} aria-pressed={reaction.authors.includes(control.identity?.id ?? '')} onClick={() => void control.action({ type: 'react', threadId: active.id, messageId: message.id, emoji: reaction.emoji })}>{reaction.emoji} {reaction.authors.length}</button>)}<details><summary aria-label="Add reaction">React</summary>{COMMENT_REACTIONS.filter(emoji => !message.reactions.some(reaction => reaction.emoji === emoji)).map(emoji => <button key={emoji} aria-label={`React ${emoji}`} onClick={() => void control.action({ type: 'react', threadId: active.id, messageId: message.id, emoji })}>{emoji}</button>)}</details></div>
        {control.owns(message.author.id) && <div className="xd-pencil-buttons"><button onClick={() => { setEditId(message.id); setEditBody(message.body); }}>Edit</button>{index === 0 && <button onClick={() => control.beginMove(active.id)}>Move pin</button>}{deleting === message.id ? <><button onClick={() => { void control.action({ type: 'delete', threadId: active.id, messageId: message.id }).then(ok => { if (ok) setDeleting(null); }); }}>Confirm delete{index === 0 ? ' thread' : ''}</button><button onClick={() => setDeleting(null)}>Keep comment</button></> : <button onClick={() => setDeleting(message.id)}>Delete</button>}</div>}
      </article>)}
      <form onSubmit={event => { event.preventDefault(); void control.action({ type: 'reply', threadId: active.id, body }).then(ok => { if (ok) setBody(''); }); }}><textarea aria-label="Reply to comment" value={body} maxLength={8192} onChange={event => setBody(event.target.value)}/><button type="submit" disabled={!body.trim() || !!error}>Reply</button></form>
    </fieldset></section>}
  </div>;
}

export function CommentCanvas({ editor, control, visible }: { editor: Editor; control: CommentController; visible: boolean }) {
  const element = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; start: Vector; screen: Vector; pan: boolean } | null>(null), space = useRef(false);
  const [region, setRegion] = useState<Vector[] | null>(null);
  const mode = useRef(control.mode); mode.current = control.mode;
  useEffect(() => { if (!control.mode) { drag.current = null; setRegion(null); space.current = false; } }, [control.mode]);
  useEffect(() => {
    const node = element.current; if (!node) return;
    const wheel = (event: WheelEvent) => { if (!mode.current) return; event.preventDefault(); event.stopPropagation(); const rect = node.getBoundingClientRect(); if (event.ctrlKey || event.metaKey) editor.applyZoom(event.deltaY, event.clientX - rect.left, event.clientY - rect.top); else editor.pan(-event.deltaX, -event.deltaY); };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, [editor]);
  const { threads, error } = read(editor), numbers = new Map(threads.map((thread, index) => [thread.id, index + 1]));
  const point = (event: { clientX: number; clientY: number }) => { const rect = element.current!.getBoundingClientRect(); return editor.screenToCanvas(event.clientX - rect.left, event.clientY - rect.top); };
  const corners = (a: Vector, b: Vector) => [{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }, { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }];
  const toScreen = (points: Vector[]) => points.map(point => ({ x: point.x * editor.state.zoom + editor.state.panX, y: point.y * editor.state.zoom + editor.state.panY }));
  const pins = error || !visible && !control.mode ? [] : threads.filter(thread => (!thread.resolved || thread.id === control.active) && resolveCommentAnchor(editor.graph, thread).pageId === editor.state.currentPageId);
  return <div ref={element} className={`xd-comment-canvas${control.mode ? ' placing' : ''}`} aria-label="Comment canvas" tabIndex={control.mode ? 0 : -1} onBlur={() => { space.current = false; }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.target !== event.currentTarget) return; if (event.code === 'Space') { event.preventDefault(); space.current = true; } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); control.cancel(); setRegion(null); drag.current = null; } }} onKeyUp={event => { if (event.code === 'Space') space.current = false; }}
    onPointerDown={event => { if (!control.mode || (event.target as HTMLElement).closest('button') || drag.current || !event.isPrimary || ![0, 1].includes(event.button)) return; event.preventDefault(); event.stopPropagation(); element.current!.focus(); const pan = event.button === 1 || space.current; drag.current = { id: event.pointerId, start: point(event), screen: { x: event.clientX, y: event.clientY }, pan }; event.currentTarget.setPointerCapture(event.pointerId); if (!pan) setRegion([point(event)]); }}
    onPointerMove={event => { const current = drag.current; if (!current || current.id !== event.pointerId) return; event.preventDefault(); if (current.pan) { editor.pan(event.clientX - current.screen.x, event.clientY - current.screen.y); current.screen = { x: event.clientX, y: event.clientY }; } else setRegion(corners(current.start, point(event))); }}
    onPointerUp={event => { const current = drag.current; if (!current || current.id !== event.pointerId) return; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); setRegion(null); if (!current.pan) { const end = point(event), distance = Math.hypot(end.x - current.start.x, end.y - current.start.y) * editor.state.zoom; control.place(distance < 4 ? [current.start] : corners(current.start, end)); } }}
    onPointerCancel={() => { drag.current = null; setRegion(null); }} onLostPointerCapture={() => { drag.current = null; setRegion(null); }}>
    <svg className="xd-comment-regions" aria-hidden="true">{pins.map(thread => { const points = toScreen(resolveCommentAnchor(editor.graph, thread).points); return points.length === 4 && <polygon key={thread.id} points={points.map(point => `${point.x},${point.y}`).join(' ')} className={control.active === thread.id ? 'selected' : ''}/>; })}{region?.length === 4 && <polygon className="selected" points={toScreen(region).map(point => `${point.x},${point.y}`).join(' ')}/>}</svg>
    {pins.map(thread => { const location = toScreen(resolveCommentAnchor(editor.graph, thread).points)[0]!; return <button key={thread.id} className={`xd-comment-pin${thread.id === control.active ? ' selected' : ''}`} style={{ left: location.x, top: location.y }} aria-label={`Open comment ${numbers.get(thread.id)} by ${thread.messages[0]!.author.name}: ${thread.messages[0]!.body.slice(0, 160)}`} aria-pressed={thread.id === control.active} onClick={event => { event.stopPropagation(); control.choose(thread.id); }}>{numbers.get(thread.id)}</button>; })}
  </div>;
}
