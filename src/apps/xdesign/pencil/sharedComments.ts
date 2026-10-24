import * as Y from 'yjs';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { COMMENT_KEY, COMMENT_PLUGIN, readPageComments, allComments, type CommentThread, type CommentMessage } from './comments';
import { decodeSharedValue, encodeSharedValue } from './sharedValue';

export function sharedMap(value: unknown): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new Error('Invalid shared design record.');
  return value;
}
export function childMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = parent.get(key);
  if (existing !== undefined) return sharedMap(existing);
  const child = new Y.Map<unknown>(); parent.set(key, child); return child;
}
export function patchFields(target: Y.Map<unknown>, before: Record<string, unknown>, after: Record<string, unknown>): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) { if (Object.hasOwn(before, key)) target.delete(key); }
    else {
      const value = encodeSharedValue(after[key]);
      if (!Object.hasOwn(before, key) || encodeSharedValue(before[key]) !== value) target.set(key, value);
    }
  }
}
function threads(graph: SceneGraph | null): Map<string, { thread: CommentThread; page: string }> {
  const result = new Map<string, { thread: CommentThread; page: string }>();
  if (graph) for (const page of graph.getPages(true)) for (const thread of readPageComments(page)) {
    if (result.has(thread.id)) throw new Error('Duplicate shared comment thread.');
    result.set(thread.id, { thread, page: page.id });
  }
  return result;
}
function messageFields(message: CommentMessage | undefined): Record<string, unknown> {
  if (!message) return {};
  const { reactions: _reactions, ...fields } = message; return fields;
}
function memberships(message: CommentMessage | undefined): Set<string> {
  return new Set(message?.reactions.flatMap(reaction => reaction.authors.map(author => JSON.stringify([reaction.emoji, author]))) ?? []);
}
export function patchSharedComments(target: Y.Map<unknown>, before: SceneGraph | null, after: SceneGraph): void {
  const old = threads(before), next = threads(after);
  for (const id of old.keys()) if (!next.has(id)) target.delete(id);
  for (const [id, { thread, page }] of next) {
    const previous = old.get(id), record = childMap(target, id);
    const fields = (entry: typeof previous): Record<string, unknown> => entry ? { id, page: entry.page, anchor: entry.thread.anchor, root: entry.thread.messages[0]!.id, resolution: { resolved: entry.thread.resolved, resolvedBy: entry.thread.resolvedBy, resolvedAt: entry.thread.resolvedAt } } : {};
    patchFields(record, fields(previous), fields({ thread, page }));
    const messages = childMap(record, 'messages'), oldMessages = new Map(previous?.thread.messages.map(message => [message.id, message]) ?? []), newMessages = new Map(thread.messages.map(message => [message.id, message]));
    for (const id of oldMessages.keys()) if (!newMessages.has(id)) messages.delete(id);
    for (const [id, message] of newMessages) {
      const stored = childMap(messages, id), previous = oldMessages.get(id);
      patchFields(stored, messageFields(previous), messageFields(message));
      const reactions = childMap(stored, 'reactions'), oldMembers = memberships(previous), members = memberships(message);
      for (const member of oldMembers) if (!members.has(member)) reactions.delete(member);
      for (const member of members) if (!oldMembers.has(member)) reactions.set(member, true);
    }
  }
}
function fields(record: Y.Map<unknown>, omitted: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of record) if (!omitted.includes(key)) Object.defineProperty(result, key, { value: decodeSharedValue(value), enumerable: true });
  return result;
}
export function readSharedComments(target: Y.Map<unknown>, graph: SceneGraph, home: string): void {
  if (target.size > 1000) throw new Error('Too many shared comment threads.');
  const pages = new Map<string, CommentThread[]>();
  for (const [id, value] of target) {
    const record = sharedMap(value), data = fields(record, ['messages']), messages = sharedMap(record.get('messages'));
    if (Object.keys(data).some(key => !['id', 'page', 'anchor', 'root', 'resolution'].includes(key)) || data.id !== id || typeof data.page !== 'string' || typeof data.root !== 'string' || messages.size > 100 || messages.size === 0) throw new Error('Invalid shared comment thread.');
    const decoded: CommentMessage[] = [];
    for (const [messageId, value] of messages) {
      const record = sharedMap(value), message = fields(record, ['reactions']), reactions = sharedMap(record.get('reactions'));
      if (message.id !== messageId || reactions.size > 1536) throw new Error('Invalid shared comment message.');
      const authors = new Map<string, string[]>();
      for (const [membership, present] of reactions) {
        const pair: unknown = JSON.parse(membership);
        if (present !== true || !Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string')) throw new Error('Invalid shared comment reaction.');
        const [emoji, author] = pair as [string, string]; authors.set(emoji, [...authors.get(emoji) ?? [], author]);
      }
      decoded.push({ ...message, reactions: [...authors].sort(([a], [b]) => a < b ? -1 : 1).map(([emoji, authors]) => ({ emoji, authors: authors.sort() })) } as CommentMessage);
    }
    if (!decoded.some(message => message.id === data.root)) throw new Error('The shared comment root is missing.');
    decoded.sort((a, b) => a.id === data.root ? -1 : b.id === data.root ? 1 : a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!data.resolution || typeof data.resolution !== 'object') throw new Error('Invalid shared comment resolution.');
    const owner = typeof data.page === 'string' && graph.getNode(data.page)?.type === 'CANVAS' ? data.page : home;
    const thread = { id, anchor: data.anchor, messages: decoded, ...data.resolution } as CommentThread;
    pages.set(owner, [...pages.get(owner) ?? [], thread]);
  }
  for (const page of graph.getPages(true)) {
    const threads = pages.get(page.id)?.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ?? [];
    page.pluginData = [...page.pluginData.filter(entry => entry.pluginId !== COMMENT_PLUGIN || entry.key !== COMMENT_KEY), ...(threads.length ? [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads }) }] : [])];
    readPageComments(page);
  }
  allComments(graph);
}
