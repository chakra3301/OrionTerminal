import { SceneGraph, getWorldMatrix, getInstanceOverride, TransformMatrix, type SceneNode, type Vector } from '@open-pencil/scene-graph';
import type { Editor } from '@open-pencil/core/editor';
import { ulid } from 'ulid';
import { serializeGraph } from './graphDocument';

export const COMMENT_PLUGIN = 'orion.xdesign.comments';
export const COMMENT_KEY = 'threads';
export const COMMENT_REACTIONS = ['👍', '❤️', '🎉', '👀', '✅', '🙏'] as const;
export type CommentAuthor = { id: string; name: string };
export type CommentAnchor = { points: Vector[]; fallback: Vector[]; nodeId?: string; instancePath?: string[]; format: 'local' | 'fig' | 'missing' };
export type CommentMessage = { id: string; author: CommentAuthor; body: string; createdAt: number; editedAt?: number; reactions: { emoji: string; authors: string[] }[] };
export type CommentThread = { id: string; anchor: CommentAnchor; messages: CommentMessage[]; resolved: boolean; resolvedBy?: CommentAuthor; resolvedAt?: number };
export type LocatedComment = CommentThread & { ownerPageId: string };
const MAX_STORAGE = 8 * 1024 * 1024;
const pageCache = new WeakMap<SceneNode, { value: string; threads: CommentThread[] }>();
function freezeData(value: unknown): void { if (value && typeof value === 'object') { Object.values(value).forEach(freezeData); Object.freeze(value); } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_./-]{1,128}$/.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const pointsValid = (value: unknown): value is Vector[] => Array.isArray(value) && [1, 4].includes(value.length) && value.every(point => record(point) && keys(point, ['x', 'y']) && ['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && Math.abs(point[key] as number) <= 1e9));
export function validCommentAuthor(value: unknown): value is CommentAuthor {
  return record(value) && keys(value, ['id', 'name']) && identifier(value.id) && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 128 && !/[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(value.name);
}
export function validCommentAnchor(value: unknown): value is CommentAnchor {
  return !(!record(value) || !keys(value, ['points', 'fallback', 'nodeId', 'instancePath', 'format']) || !pointsValid(value.points) || !pointsValid(value.fallback) || value.points.length !== value.fallback.length || !['local', 'fig', 'missing'].includes(String(value.format)) || value.nodeId !== undefined && !identifier(value.nodeId) || value.instancePath !== undefined && (!Array.isArray(value.instancePath) || !value.instancePath.length || value.instancePath.length > 64 || !value.instancePath.every(identifier) || !value.nodeId || value.format !== 'fig'));
}
function validateThread(value: unknown): asserts value is CommentThread {
  if (!record(value) || !keys(value, ['id', 'anchor', 'messages', 'resolved', 'resolvedBy', 'resolvedAt']) || !identifier(value.id) || typeof value.resolved !== 'boolean' || !validCommentAnchor(value.anchor) || !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100) throw new Error('Invalid comment thread data. Existing comments were preserved.');
  if (value.resolvedBy !== undefined && !validCommentAuthor(value.resolvedBy) || value.resolvedAt !== undefined && !timestamp(value.resolvedAt)) throw new Error('Invalid comment resolution data.');
  const ids = new Set<string>();
  for (const message of value.messages) {
    if (!record(message) || !keys(message, ['id', 'author', 'body', 'createdAt', 'editedAt', 'reactions']) || !identifier(message.id) || ids.has(message.id) || !validCommentAuthor(message.author) || typeof message.body !== 'string' || !message.body.trim() || message.body.length > 8192 || !timestamp(message.createdAt) || message.editedAt !== undefined && !timestamp(message.editedAt) || !Array.isArray(message.reactions) || message.reactions.length > COMMENT_REACTIONS.length) throw new Error('Invalid comment message data.');
    ids.add(message.id);
    const emojis = new Set<string>();
    for (const reaction of message.reactions) {
      if (!record(reaction) || !keys(reaction, ['emoji', 'authors']) || !COMMENT_REACTIONS.includes(reaction.emoji as typeof COMMENT_REACTIONS[number]) || emojis.has(String(reaction.emoji)) || !Array.isArray(reaction.authors) || reaction.authors.length > 256 || !reaction.authors.every(identifier) || new Set(reaction.authors).size !== reaction.authors.length) throw new Error('Invalid comment reaction data.');
      emojis.add(String(reaction.emoji));
    }
  }
}
export function readPageComments(page: SceneNode): CommentThread[] {
  const entries = page.pluginData.filter(entry => entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY);
  if (!entries.length) return [];
  if (entries.length !== 1 || entries[0]!.value.length > MAX_STORAGE) throw new Error('Invalid or oversized comment storage. Existing comments were preserved.');
  const cached = pageCache.get(page); if (cached?.value === entries[0]!.value) return cached.threads;
  let data: unknown;
  try { data = JSON.parse(entries[0]!.value); } catch { throw new Error('Comment storage could not be read. Existing comments were preserved.'); }
  if (!record(data) || !keys(data, ['version', 'threads']) || data.version !== 1 || !Array.isArray(data.threads) || data.threads.length > 1000) throw new Error('Unsupported comment storage. Existing comments were preserved.');
  data.threads.forEach(validateThread);
  freezeData(data.threads); pageCache.set(page, { value: entries[0]!.value, threads: data.threads as CommentThread[] });
  return data.threads as CommentThread[];
}
export function allComments(graph: SceneGraph): LocatedComment[] {
  const result: LocatedComment[] = [], ids = new Set<string>(); let units = 0;
  for (const page of graph.getPages()) {
    units += page.pluginData.filter(entry => entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY).reduce((size, entry) => size + entry.value.length, 0);
    if (units > MAX_STORAGE) throw new Error('Comments exceed the 8Mi character storage limit.');
    for (const thread of readPageComments(page)) {
      if (ids.has(thread.id) || result.length >= 1000) throw new Error('Duplicate or excessive comment threads. Existing comments were preserved.');
      ids.add(thread.id); result.push({ ...thread, ownerPageId: page.id });
    }
  }
  return result;
}
export function commentTarget(graph: SceneGraph, anchor: CommentAnchor): SceneNode | undefined {
  if (!anchor.nodeId || anchor.format === 'missing') return;
  if (anchor.format === 'local') return graph.getNode(anchor.nodeId);
  const matches = [...graph.nodes.values()].filter(node => {
    if (node.source.id !== anchor.nodeId) return false;
    let parent = node.parentId ? graph.getNode(node.parentId) : undefined;
    while (parent) { if (parent.type === 'INSTANCE') return false; parent = parent.parentId ? graph.getNode(parent.parentId) : undefined; }
    return true;
  });
  let target = matches.length === 1 ? matches[0] : undefined;
  for (const guid of anchor.instancePath ?? []) {
    if (!target || target.type !== 'INSTANCE') return;
    const root = target, candidates: SceneNode[] = [], pending = [...root.childIds], seen = new Set<string>();
    while (pending.length) {
      const node = graph.getNode(pending.pop()!); if (!node || seen.has(node.id)) continue; seen.add(node.id);
      const mapped = getInstanceOverride(root.instanceOverrides, root.id, node.id, 'sourceComponentId');
      let source = graph.getNode(typeof mapped === 'string' ? mapped : node.componentId ?? ''), matches = node.source.id === guid;
      const sourceIds = new Set<string>();
      while (source && !sourceIds.has(source.id) && sourceIds.size < 64) {
        sourceIds.add(source.id); if (source.source.id === guid) { matches = true; break; }
        let owner = source.parentId ? graph.getNode(source.parentId) : undefined;
        while (owner && owner.type !== 'INSTANCE') owner = owner.parentId ? graph.getNode(owner.parentId) : undefined;
        const reference = owner && getInstanceOverride(owner.instanceOverrides, owner.id, source.id, 'sourceComponentId');
        source = graph.getNode(typeof reference === 'string' ? reference : source.componentId ?? '');
      }
      if (matches) candidates.push(node);
      if (node.type !== 'INSTANCE') pending.push(...node.childIds);
    }
    target = candidates.length === 1 ? candidates[0] : undefined;
  }
  return target;
}
export function materializeCommentTargets(graph: SceneGraph): boolean {
  try { allComments(graph); } catch { return false; }
  let changed = false;
  for (const page of graph.getPages()) {
    const threads = readPageComments(page); if (!threads.some(thread => thread.anchor.nodeId && thread.anchor.format === 'fig')) continue;
    const mapped = threads.map(thread => {
      if (!thread.anchor.nodeId || thread.anchor.format !== 'fig') return thread;
      const target = commentTarget(graph, thread.anchor), { instancePath: _path, ...anchor } = thread.anchor;
      return { ...thread, anchor: { ...anchor, nodeId: target?.id ?? anchor.nodeId, format: target ? 'local' as const : 'missing' as const } };
    });
    graph.updateNode(page.id, { pluginData: [...page.pluginData.filter(entry => !(entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY)), { pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: mapped }) }] }); changed = true;
  }
  return changed;
}
function pageOf(graph: SceneGraph, node: SceneNode): string | undefined {
  let current: SceneNode | undefined = node; const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.type === 'CANVAS') return current.id;
    seen.add(current.id); current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }
}
export function resolveCommentAnchor(graph: SceneGraph, thread: LocatedComment) {
  const target = commentTarget(graph, thread.anchor), page = target && pageOf(graph, target);
  if (!target || !page || target.width <= 0 || target.height <= 0) return { points: thread.anchor.fallback, pageId: thread.ownerPageId, missingTarget: !!thread.anchor.nodeId, target: undefined };
  const matrix = getWorldMatrix(target, graph), points = thread.anchor.points.map(point => TransformMatrix.mapPoint(matrix, { x: point.x * target.width, y: point.y * target.height }));
  if (!pointsValid(points)) return { points: thread.anchor.fallback, pageId: thread.ownerPageId, missingTarget: true, target: undefined };
  return { points, pageId: page, missingTarget: false, target };
}
export function createCommentAnchor(graph: SceneGraph, pageId: string, points: Vector[], selectedId?: string): CommentAnchor {
  if (!pointsValid(points) || graph.getNode(pageId)?.type !== 'CANVAS') throw new Error('Choose a valid comment position on a page.');
  let target = selectedId ? graph.getNode(selectedId) : graph.hitTestDeep(points[0]!.x, points[0]!.y, pageId) ?? undefined;
  if (!selectedId) while (target?.parentId && target.parentId !== pageId) target = graph.getNode(target.parentId);
  const fallback = structuredClone(points);
  if (!target || target.type === 'CANVAS' || pageOf(graph, target) !== pageId || target.width <= 0 || target.height <= 0) return { points: fallback, fallback, format: 'local' };
  const inverse = TransformMatrix.invert(getWorldMatrix(target, graph));
  if (!inverse) return { points: fallback, fallback, format: 'local' };
  const relative = points.map(point => { const local = TransformMatrix.mapPoint(inverse, point); return { x: local.x / target!.width, y: local.y / target!.height }; });
  if (!pointsValid(relative)) throw new Error('This layer has an unsupported comment transform.');
  return { points: relative, fallback, nodeId: target.id, format: 'local' };
}
function message(author: CommentAuthor, body: string): CommentMessage {
  if (!validCommentAuthor(author) || !body.trim() || body.length > 8192) throw new Error('Enter a comment of at most 8,192 characters and a valid author name.');
  return { id: ulid(), author: { ...author }, body, createdAt: Date.now(), reactions: [] };
}
function commit(editor: Editor, pageId: string, threads: CommentThread[], label: string, publish?: () => void) {
  threads.forEach(validateThread);
  const page = editor.graph.getNode(pageId); if (page?.type !== 'CANVAS') throw new Error('The comment page is no longer available.');
  const before = page.pluginData.find(entry => entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY)?.value;
  const after = threads.length ? JSON.stringify({ version: 1, threads }) : undefined;
  if (before === after) return;
  if ((after?.length ?? 0) > MAX_STORAGE) throw new Error('Comments exceed the 8Mi character storage limit.');
  const pluginData = (node: SceneNode, value?: string) => [...node.pluginData.filter(entry => !(entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY)), ...(value ? [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value }] : [])];
  // Preflight the real persistence representation without publishing or copying artwork.
  const probe = new SceneGraph(); Object.assign(probe, editor.graph); probe.nodes = new Map(editor.graph.nodes);
  probe.nodes.set(pageId, { ...page, pluginData: pluginData(page, after) }); allComments(probe); serializeGraph(probe);
  const replay = (value?: string) => { const current = editor.graph.getNode(pageId); if (current) editor.graph.updateNode(pageId, { pluginData: pluginData(current, value) }); editor.requestRender(); };
  try { replay(after); publish?.(); } catch (error) { replay(before); throw error; }
  editor.pushUndoEntry({ label, forward: () => replay(after), inverse: () => replay(before) });
}
export function addComment(editor: Editor, pageId: string, anchor: CommentAnchor, author: CommentAuthor, body: string, publish?: () => void): string {
  allComments(editor.graph);
  const thread: CommentThread = { id: ulid(), anchor: structuredClone(anchor), messages: [message(author, body)], resolved: false };
  const page = editor.graph.getNode(pageId); if (!page) throw new Error('The comment page is no longer available.');
  commit(editor, pageId, [...readPageComments(page), thread], 'Add comment', publish); return thread.id;
}
function edit(editor: Editor, id: string, label: string, work: (thread: CommentThread) => void | 'delete', publish?: () => void) {
  const found = allComments(editor.graph).find(thread => thread.id === id); if (!found) throw new Error('This comment is no longer available.');
  const page = editor.graph.getNode(found.ownerPageId)!, threads = readPageComments(page), next = structuredClone(threads), index = next.findIndex(thread => thread.id === id);
  if (work(next[index]!) === 'delete') next.splice(index, 1);
  commit(editor, page.id, next, label, publish);
}
export function replyToComment(editor: Editor, id: string, author: CommentAuthor, body: string, publish?: () => void) {
  edit(editor, id, 'Reply to comment', thread => { if (thread.messages.length >= 100) throw new Error('A thread can contain at most 100 messages.'); thread.messages.push(message(author, body)); }, publish);
}
export function editCommentMessage(editor: Editor, id: string, messageId: string, author: CommentAuthor, body: string, publish?: () => void) {
  edit(editor, id, 'Edit comment', thread => { const item = thread.messages.find(message => message.id === messageId); if (!item || !validCommentAuthor(author) || item.author.id !== author.id) throw new Error('Only the message author can edit this comment.'); const replacement = message(author, body); item.body = replacement.body; item.editedAt = replacement.createdAt; }, publish);
}
export function deleteCommentMessage(editor: Editor, id: string, messageId: string, author: CommentAuthor, publish?: () => void) {
  edit(editor, id, 'Delete comment', thread => { const index = thread.messages.findIndex(message => message.id === messageId); if (index < 0 || !validCommentAuthor(author) || thread.messages[index]!.author.id !== author.id) throw new Error('Only the message author can delete this comment.'); if (index === 0) return 'delete'; thread.messages.splice(index, 1); }, publish);
}
export function resolveComment(editor: Editor, id: string, resolved: boolean, author: CommentAuthor, publish?: () => void) {
  if (!validCommentAuthor(author)) throw new Error('Choose a valid comment author.');
  edit(editor, id, resolved ? 'Resolve comment' : 'Reopen comment', thread => { if (thread.resolved === resolved) return; thread.resolved = resolved; if (resolved) { thread.resolvedBy = { ...author }; thread.resolvedAt = Date.now(); } else { delete thread.resolvedBy; delete thread.resolvedAt; } }, publish);
}
export function moveComment(editor: Editor, id: string, anchor: CommentAnchor, author: CommentAuthor, publish?: () => void) {
  edit(editor, id, 'Move comment', thread => { if (!validCommentAuthor(author) || thread.messages[0]!.author.id !== author.id) throw new Error('Only the original author can move this comment.'); thread.anchor = structuredClone(anchor); }, publish);
}
export function reactToComment(editor: Editor, id: string, messageId: string, emoji: string, author: CommentAuthor, publish?: () => void) {
  if (!validCommentAuthor(author) || !COMMENT_REACTIONS.includes(emoji as typeof COMMENT_REACTIONS[number])) throw new Error('Choose a supported comment reaction.');
  edit(editor, id, 'React to comment', thread => { const item = thread.messages.find(message => message.id === messageId); if (!item) throw new Error('This message is no longer available.'); let reaction = item.reactions.find(reaction => reaction.emoji === emoji); if (!reaction) { reaction = { emoji, authors: [] }; item.reactions.push(reaction); } const index = reaction.authors.indexOf(author.id); if (index >= 0) reaction.authors.splice(index, 1); else { if (reaction.authors.length >= 256) throw new Error('A reaction supports at most 256 authors.'); reaction.authors.push(author.id); } item.reactions = item.reactions.filter(reaction => reaction.authors.length); }, publish);
}
