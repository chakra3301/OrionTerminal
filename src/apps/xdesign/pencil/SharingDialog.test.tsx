import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { SharingDialog } from './SharingDialog';
import { CanvasRoomSession, prepareSharedRoom } from './roomSession';
import { loadRoomGrants, rememberRoomGrant, roomGrantKey, type PendingRoomCreation, type PendingRoomInvitation, type PendingRoomAuthorGrant } from './roomGrants';
import { usePencilWorkspace } from './runtime';
const host = vi.hoisted(() => ({ data: new Map<string, unknown>(), clipboard: vi.fn(), prepare: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: async (key: string) => structuredClone(host.data.get(key) ?? null), setAppState: async (key: string, value: unknown) => { await host.save(); host.data.set(key, structuredClone(value)); } }));
vi.mock('./roomSession', async original => ({ ...await original<typeof import('./roomSession')>(), prepareSharedRoom: host.prepare }));
const projectId = ulid(), documentId = ulid(), ownerId = ulid(), serverUrl = 'https://rooms.example.test/', memberId = ulid(), credential = `${memberId}.${'a'.repeat(43)}`;
let root: Root, container: HTMLDivElement, room: CanvasRoomSession;
const close = vi.fn();
const invitation = (): PendingRoomInvitation => ({ kind: 'invite', projectId, documentId, serverUrl, ownerId, requestId: ulid(), name: 'Reviewer', role: 'viewer' });
const grant = (pending: PendingRoomInvitation) => ({ requestId: pending.requestId, actor: { id: memberId, name: pending.name, role: pending.role }, credential });
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === label || value.getAttribute('aria-label') === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function input(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function render(session: CanvasRoomSession | null = room) { await act(async () => root.render(<SharingDialog session={session} close={close}/>)); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: host.clipboard } });
  host.data.clear(); host.clipboard.mockReset(); host.prepare.mockReset(); host.save.mockReset(); close.mockReset(); usePencilWorkspace.setState({ readOnly: false });
  const snapshot = { opening: false, error: null, creation: null, preference: { documentId, serverUrl, role: 'owner', revision: 1 }, connection: { phase: 'online', unsent: false, actor: { id: ownerId, name: 'Owner', role: 'owner' } } };
  room = { projectId, documentId, snapshot, subscribe: (listener: (state: unknown) => void) => { listener(snapshot); return () => {}; },
    invite: vi.fn(async () => { const pending = invitation(); await rememberRoomGrant(pending); return { pending, grant: grant(pending) }; }),
    recoverInvitation: vi.fn(async (pending: PendingRoomInvitation) => grant(pending)), connect: vi.fn(async () => {}), publishCreation: vi.fn(async () => {}), recoverProject: vi.fn(async () => 'recovered_project_001'), members: vi.fn(async () => []), disconnect: vi.fn(), retry: vi.fn(),
  } as unknown as CanvasRoomSession;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); await render();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps a failed clipboard handoff recoverable after closing and only clears it after successful copy and Done', async () => {
  await input('Invitation member name', 'Reviewer'); await click('Create invitation'); expect(container.querySelector('[aria-label="Invitation handoff"]')).not.toBeNull(); expect(button('Done').disabled).toBe(true);
  host.clipboard.mockRejectedValueOnce(new Error('Clipboard unavailable')); await click('Copy invitation'); expect(container.textContent).toContain('Clipboard unavailable'); expect(await loadRoomGrants(projectId)).toHaveLength(1); expect(JSON.stringify(host.data.get(roomGrantKey(projectId)))).not.toContain(credential);
  act(() => root.unmount()); root = createRoot(container); await render(); expect(container.querySelector('[aria-label="Invitation credential"]')).toBeNull(); await click('Recover invitation for Reviewer'); expect(room.recoverInvitation).toHaveBeenCalledOnce();
  await click('Copy invitation'); expect(host.clipboard).toHaveBeenLastCalledWith(expect.stringContaining(`Membership credential: ${credential}`)); expect(host.clipboard).toHaveBeenLastCalledWith(expect.stringContaining(`Document ID: ${documentId}`)); expect(await loadRoomGrants(projectId)).toHaveLength(1);
  host.save.mockRejectedValueOnce(new Error('Disk full')); await click('Done'); expect(container.textContent).toContain('Disk full'); expect(await loadRoomGrants(projectId)).toHaveLength(1); expect(container.querySelector('[aria-label="Invitation handoff"]')).not.toBeNull();
  await click('Done'); expect(await loadRoomGrants(projectId)).toEqual([]); expect(container.querySelector('[aria-label="Invitation handoff"]')).toBeNull();
});
it('shows a persisted lost invitation reply for recovery and prevents another identical invitation', async () => {
  vi.mocked(room.invite).mockImplementationOnce(async () => { await rememberRoomGrant(invitation()); throw new Error('Outcome unknown'); });
  await input('Invitation member name', 'Reviewer'); await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="Invitation access"]')!; select.value = 'viewer'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Create invitation'); expect(container.textContent).toContain('Outcome unknown'); expect(button('Create invitation').disabled).toBe(true); await click('Recover invitation for Reviewer'); expect(room.invite).toHaveBeenCalledOnce();
  await click('Dismiss request for Reviewer'); expect(await loadRoomGrants(projectId)).toEqual([]); expect(container.textContent).toContain('Members'); expect(room.members).not.toHaveBeenCalled();
});
it('creates a shared copy with explicit room/owner names and leaves administrator entry to publishing', async () => {
  await click('Create room'); await input('Shared project name', 'Team design'); await input('Room owner name', 'Designer'); await input('Room server', serverUrl);
  expect(container.querySelector('[aria-label="Room administrator credential"]')).toBeNull(); await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(prepareSharedRoom).toHaveBeenCalledWith(serverUrl, 'Team design', 'Designer', expect.any(AbortSignal)); expect(room.connect).not.toHaveBeenCalled();
});
it('publishes pending creation with its pinned server and clears the administrator field after handoff', async () => {
  act(() => root.unmount()); const creation: PendingRoomCreation = { kind: 'create', projectId, documentId, serverUrl, requestId: ulid(), name: 'Shared copy', ownerName: 'Owner', checkpointSha256: 'a'.repeat(64) };
  room.snapshot.creation = creation; usePencilWorkspace.setState({ readOnly: true }); root = createRoot(container); await render(); expect(button('Create room').disabled).toBe(true); expect(container.querySelector<HTMLInputElement>('[aria-label="Room server"]')!.readOnly).toBe(true);
  await input('Room administrator credential', 'x'.repeat(40)); await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(room.publishCreation).toHaveBeenCalledWith('x'.repeat(40), expect.any(AbortSignal)); expect(room.connect).toHaveBeenCalledWith(serverUrl); expect(container.querySelector<HTMLInputElement>('[aria-label="Room administrator credential"]')!.value).toBe('');
});
async function recoveryDialog(phase='error') {
  act(()=>root.unmount());room.snapshot.connection={...room.snapshot.connection!,phase:phase as 'error',unsent:true,error:'Upload rejected'};root=createRoot(container);await render();
}
it('offers explicit local and latest-shared recovery only for retained work that needs attention',async()=>{
  expect(container.querySelector('[aria-label="Recover local artwork"]')).toBeNull();await recoveryDialog();expect(container.textContent).toContain('original project');
  await click('Save local copy');expect(room.recoverProject).toHaveBeenCalledWith('local',expect.any(AbortSignal));await click('Open latest shared version');expect(room.recoverProject).toHaveBeenLastCalledWith('latest',expect.any(AbortSignal));
});
it('keeps recovery failure visible and preserves credentials and retry controls',async()=>{
  await recoveryDialog();await input('Room membership credential',credential);vi.mocked(room.recoverProject).mockRejectedValueOnce(new Error('Disk full'));await click('Open latest shared version');
  expect(container.querySelector('[role="alert"]')!.textContent).toBe('Disk full');expect(container.querySelector<HTMLInputElement>('[aria-label="Room membership credential"]')!.value).toBe(credential);expect(button('Retry connection').disabled).toBe(false);
});
it('holds a single recovery operation, disables competing controls and aborts on unmount',async()=>{
  await recoveryDialog();let release!:(value:string)=>void;vi.mocked(room.recoverProject).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await click('Open latest shared version');expect(button('Save local copy').disabled).toBe(true);expect(button('Close').disabled).toBe(true);await click('Save local copy');expect(room.recoverProject).toHaveBeenCalledOnce();
  const signal=vi.mocked(room.recoverProject).mock.calls[0]![1];act(()=>root.unmount());expect(signal.aborted).toBe(true);release('recovered_project_001');await act(async()=>{});root=createRoot(container);await render();
});
it('shows viewer recovery without offering room creation and hides it from other tabs',async()=>{
  usePencilWorkspace.setState({readOnly:true});await recoveryDialog('readonly');expect(button('Create room').disabled).toBe(true);expect(button('Save local copy').disabled).toBe(false);await click('Join room');expect(container.querySelector('[aria-label="Recover local artwork"]')).toBeNull();
});

it('keeps original-author grants explicit, member-selected and attributed to original names', async () => {
  room.commentAuthors = vi.fn(async () => ({ authors: [{ authorId: 'legacy_author', name: 'Original', memberId: null, step: 0 }], members: [{ id: memberId, name: 'Reviewer', role: 'viewer' as const, revoked: false }] }));
  room.assignCommentAuthor = vi.fn(async () => ({ version: 1 as const, documentId, requestId: ulid(), actor: { id: ownerId, name: 'Owner', role: 'owner' as const }, assignment: { authorId: 'legacy_author', memberId, step: 1 }, current: { authorId: 'legacy_author', memberId, step: 1 } }));
  expect(room.commentAuthors).not.toHaveBeenCalled(); await click('Refresh original authors'); expect(container.textContent).toContain('Original'); expect(button('Save author assignment for legacy_author').disabled).toBe(true);
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="Editing member for legacy_author"]')!; select.value = memberId; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Save author assignment for legacy_author'); expect(room.assignCommentAuthor).toHaveBeenCalledWith(expect.objectContaining({ authorId: 'legacy_author', name: 'Original', step: 0 }), memberId, expect.any(AbortSignal)); expect(button('Save author assignment for legacy_author').disabled).toBe(true);
});
it('recovers pending original-author assignments and confirms local dismissal without changing server permissions', async () => {
  const pending: PendingRoomAuthorGrant = { kind: 'author', projectId, documentId, serverUrl, ownerId, requestId: ulid(), name: 'Original', authorId: 'legacy_author', memberId, step: 0 }; await rememberRoomGrant(pending);
  act(() => root.unmount()); root = createRoot(container); await render(); room.recoverCommentAuthor = vi.fn(async () => { throw new Error('Outcome unknown'); });
  await click('Recover author assignment for legacy_author'); expect(room.recoverCommentAuthor).toHaveBeenCalledWith(pending, expect.any(AbortSignal)); expect(await loadRoomGrants(projectId)).toEqual([pending]);
  await click('Dismiss author assignment for legacy_author'); expect(container.textContent).toContain('may still apply'); expect(await loadRoomGrants(projectId)).toEqual([pending]); await click('Confirm dismiss author assignment for legacy_author'); expect(await loadRoomGrants(projectId)).toEqual([]); expect(room.recoverCommentAuthor).toHaveBeenCalledOnce();
});
it('renders only one bounded original-author page and keeps equal names distinguishable by identity', async () => {
  room.commentAuthors = vi.fn(async () => ({ authors: Array.from({ length: 51 }, (_, index) => ({ authorId: `legacy_${index}`, name: 'Same name', memberId: null, step: 0 })), members: [] }));
  await click('Refresh original authors'); expect(container.querySelectorAll('[aria-label^="Editing member for"]')).toHaveLength(25); expect(container.textContent).toContain('1–25 of 51'); await click('Next authors'); expect(container.textContent).toContain('26–50 of 51'); await input('Find original comment authors', 'legacy_50'); expect(container.querySelectorAll('[aria-label^="Editing member for"]')).toHaveLength(1); expect(container.textContent).toContain('legacy_50');
});
