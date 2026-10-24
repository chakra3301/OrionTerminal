import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { RoomAuthorsPanel } from './RoomAuthorsPanel';
import { rememberRoomGrant, type PendingRoomAuthorGrant } from './roomGrants';
import type { CanvasRoomSession } from './roomSession';
const db = vi.hoisted(() => ({ data: new Map<string, unknown>(), read: vi.fn() }));
vi.mock('@/lib/db', () => ({ getAppState: (key: string) => db.read(key), setAppState: async (key: string, value: unknown) => { db.data.set(key, structuredClone(value)); } }));
let container: HTMLDivElement, root: Root, session: CanvasRoomSession;
const author = { authorId: 'legacy_author', name: 'Original', memberId: null, step: 0 }, ownerId = ulid(), memberId = ulid(), documentId = ulid(), projectId = ulid(), serverUrl = 'https://rooms.example.test/';
const errors = vi.fn();
const run = async (work: (signal: AbortSignal) => Promise<void>) => { try { await work(new AbortController().signal); } catch (error) { errors(error); } };
const request = (): PendingRoomAuthorGrant => ({ kind: 'author', requestId: ulid(), ownerId, memberId, projectId, documentId, serverUrl, name: author.name, authorId: author.authorId, step: 0 });
function render() { return act(async () => root.render(<RoomAuthorsPanel session={session} owner pending={false} run={run}/>)); }
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); db.data.clear(); db.read.mockReset(); db.read.mockImplementation(async key => structuredClone(db.data.get(key) ?? null)); errors.mockReset();
  session = { projectId, documentId, snapshot: { preference: { serverUrl }, connection: { actor: { id: ownerId } } }, commentAuthors: vi.fn(async () => ({ authors: [author], members: [{ id: memberId, name: 'Reviewer', role: 'viewer', revoked: false }] })) } as unknown as CanvasRoomSession;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('ignores an older storage read after a newer failed assignment becomes recoverable', async () => {
  let release!: (value: unknown) => void; db.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await render(); await click('Refresh original authors');
  session.assignCommentAuthor = vi.fn(async () => { await rememberRoomGrant(request()); throw new Error('Outcome unknown'); });
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('select')!; select.value = memberId; select.dispatchEvent(new Event('change', { bubbles: true })); }); await click('Save author assignment for legacy_author');
  expect(container.textContent).toContain('Pending author assignments'); expect(button('Save author assignment for legacy_author').disabled).toBe(true); await act(async () => release(null)); expect(container.textContent).toContain('Pending author assignments'); expect(button('Save author assignment for legacy_author').disabled).toBe(true);
});
it('drops late old-server catalog results even when the same canvas session changes its connection', async () => {
  let release!: (value: Awaited<ReturnType<CanvasRoomSession['commentAuthors']>>) => void; session.commentAuthors = vi.fn(() => new Promise<Awaited<ReturnType<CanvasRoomSession['commentAuthors']>>>(resolve => { release = resolve; })); await render(); await click('Refresh original authors');
  session.snapshot.preference!.serverUrl = 'https://other.example.test/'; await render(); await act(async () => release({ authors: [author], members: [] })); expect(container.querySelector('[aria-label="Editing member for legacy_author"]')).toBeNull(); expect(container.querySelector('[aria-label="Find original comment authors"]')).toBeNull();
});
it('does not apply a late old-project pending read to a different project', async () => {
  let release!: (value: unknown) => void; db.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await render();
  const old = request(); session = { ...session, projectId: ulid() } as unknown as CanvasRoomSession; await render(); await act(async () => release({ version: 1, grants: [old] })); expect(container.textContent).not.toContain('Pending author assignments');
});

it('supports original author IDs that match inherited object property names', async () => {
  session.commentAuthors = vi.fn(async () => ({ authors: ['constructor', '__proto__', 'toString'].map(authorId => ({ ...author, authorId })), members: [{ id: memberId, name: 'Reviewer', role: 'viewer' as const, revoked: false }] })); await render(); await click('Refresh original authors');
  for (const authorId of ['constructor','__proto__','toString']) { expect(container.querySelector<HTMLSelectElement>(`[aria-label="Editing member for ${authorId}"]`)!.value).toBe(''); expect(button(`Save author assignment for ${authorId}`).disabled).toBe(true); }
  const assigned = { ...author, authorId: 'constructor', memberId, step: 1 }; session.assignCommentAuthor = vi.fn(async () => ({ version: 1 as const, documentId, actor: { id: ownerId, name: 'Owner', role: 'owner' as const }, requestId: ulid(), assignment: assigned, current: assigned }));
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="Editing member for constructor"]')!; select.value = memberId; select.dispatchEvent(new Event('change', { bubbles: true })); }); await click('Save author assignment for constructor'); expect(session.assignCommentAuthor).toHaveBeenCalledWith(expect.objectContaining({ authorId: 'constructor' }), memberId, expect.any(AbortSignal));
});
