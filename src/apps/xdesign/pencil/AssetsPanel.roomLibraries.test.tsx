import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { PencilLibrarySummary } from './roomLibraryCatalog';
import type { RoomUiState, CanvasRoomSession } from './roomSession';
import type { RoomLibraryDraft } from './roomLibraryClient';
import { libraryActor, libraryFixture, libraryProjectId, libraryRecord, libraryScope } from './roomLibraries.testSupport';

const host = vi.hoisted(() => ({ list: vi.fn(), assets: vi.fn(), getRevision: vi.fn(), publish: vi.fn(), refresh: vi.fn(), download: vi.fn(), prepare: vi.fn(), recover: vi.fn(), dismiss: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
vi.mock('./runtime', async () => { const { create } = await import('zustand'); return { usePencilWorkspace: create<{ editor: Editor | null; busy: boolean; readOnly: boolean; version: number }>(() => ({ editor: null, busy: false, readOnly: false, version: 0 })), executeDesignToolAsync: vi.fn(), runPencilLibraryAction: vi.fn(), libraryPhotoBytes: vi.fn() }; });
vi.mock('./librarySession', () => ({ pencilLibraries: () => ({ listLibraries: host.list, listComponents: host.assets }), publicationSelection: vi.fn() }));
vi.mock('./libraryCatalog', () => ({ orionLibraryCatalog: { getRevision: host.getRevision } }));
vi.mock('./LibraryPreviewPanel', () => ({ LibraryPreviewPanel: () => null }));
import { usePencilWorkspace } from './runtime';
import { AssetsPanel } from './AssetsPanel';
let root: Root, container: HTMLElement, editor: Editor, draft: RoomLibraryDraft;
const room = { refreshLibraries: host.refresh, downloadLibrary: host.download, prepareLibraryPublication: host.prepare, publishLibrary: host.publish, recoverLibraryPublication: host.recover, dismissLibraryPublication: host.dismiss } as unknown as CanvasRoomSession;
function state(viewer = false): RoomUiState { return { preference: { ...libraryScope, revision: 1, role: viewer ? 'viewer' : 'owner' }, connection: { phase: viewer ? 'readonly' : 'online', actor: { ...libraryActor, role: viewer ? 'viewer' : 'owner' }, revision: 1, unsent: false, attempt: 0, error: null }, opening: false, creation: null, presence: null, error: null, libraries: { phase: 'ready', pending: null, actor: null, libraries: [], error: null, cacheVersion: 0 } }; }
async function render(value = state()) { await act(async () => root.render(<AssetsPanel room={room} roomState={value}/>)); }
function button(text: string, scope: ParentNode = container) { const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text); if (!found) throw new Error(`Missing button: ${text}`); return found; }
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.values(host).forEach(mock => mock.mockReset());
  editor = createEditor(); container = document.createElement('div'); container.className = 'xd-pencil'; document.body.append(container); root = createRoot(container);
  usePencilWorkspace.setState({ editor, busy: false, readOnly: false, version: 0 });
  const revision = await libraryFixture(), record = await libraryRecord(revision); draft = { scope: libraryScope, actorId: libraryActor.id, epoch: 1, packet: { version: 1, requestId: 'publication_request_001', bundle: record.bundle }, changes: [{ kind: 'added', asset: revision.manifest.assets[0]! }] };
  const summary: PencilLibrarySummary = { libraryId: revision.manifest.libraryId, name: revision.manifest.name, latestRevisionId: revision.manifest.revisionId, publishedAt: revision.manifest.publishedAt, assetCount: revision.manifest.assets.length, origin: 'device' };
  host.list.mockResolvedValue([summary, { ...summary, libraryId: 'orion-room-downloaded-library', name: 'Downloaded controls', origin: 'room' }]); host.assets.mockResolvedValue([]); host.getRevision.mockResolvedValue(revision); host.prepare.mockResolvedValue(draft); host.publish.mockResolvedValue({}); host.refresh.mockResolvedValue(undefined); host.download.mockResolvedValue(undefined); host.recover.mockResolvedValue({}); host.dismiss.mockResolvedValue(undefined);
});
afterEach(() => { act(() => root.unmount()); editor.dispose(); container.remove(); vi.unstubAllGlobals(); });
it('shows device and downloaded origins and performs no room operation until an explicit action', async () => {
  const value = state(); value.libraries!.libraries = [(await libraryRecord(await libraryFixture())).publication]; await render(value);
  expect(container.textContent).toContain('On this device'); expect(container.textContent).toContain('Downloaded from this room'); expect(host.refresh).not.toHaveBeenCalled(); expect(host.download).not.toHaveBeenCalled(); expect(host.prepare).not.toHaveBeenCalled(); expect(host.publish).not.toHaveBeenCalled();
  await act(async () => button('Refresh room libraries').click()); expect(host.refresh).toHaveBeenCalledOnce(); await act(async () => button('Download revision').click()); expect(host.download).toHaveBeenCalledWith(draft.packet.bundle.manifest.libraryId);
  expect([...container.querySelectorAll('button')].filter(item => item.textContent === 'Publish to room')).toHaveLength(1);
});
it('requires the publication review dialog before posting and keeps a rejected reviewed draft available', async () => {
  await render(); await act(async () => button('Publish to room').click()); expect(host.prepare).toHaveBeenCalledOnce(); expect(host.publish).not.toHaveBeenCalled(); const modal = container.querySelector('[role="dialog"]')!; expect(modal.getAttribute('aria-label')).toBe('Publish library to shared room'); expect(modal.textContent).toContain('added');
  host.publish.mockRejectedValueOnce(new Error('Room changed after review')); await act(async () => button('Publish to room', modal).click()); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Room changed after review'); expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  await act(async () => button('Publish to room', container.querySelector('[role="dialog"]')!).click()); expect(host.publish).toHaveBeenLastCalledWith(draft); expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('keeps viewer refresh, download and accepted recovery available while publication and artwork controls stay disabled', async () => {
  const value = state(true); value.libraries!.libraries = [(await libraryRecord(await libraryFixture())).publication]; value.libraries!.pending = { projectId: libraryProjectId, ...libraryScope, actorId: libraryActor.id, requestId: draft.packet.requestId, libraryId: draft.packet.bundle.manifest.libraryId, revisionId: draft.packet.bundle.manifest.revisionId, name: draft.packet.bundle.manifest.name }; usePencilWorkspace.setState({ readOnly: true }); await render(value);
  expect(button('Publish to room').disabled).toBe(true); expect(button('Publish').disabled).toBe(true); expect(button('Refresh room libraries').disabled).toBe(false); expect(button('Download revision').disabled).toBe(false); expect(button('Recover publication').disabled).toBe(false);
  await act(async () => button('Recover publication').click()); expect(host.recover).toHaveBeenCalledOnce(); expect(host.publish).not.toHaveBeenCalled();
});
it('requires explicit local dismissal confirmation and allows it offline without contacting the room', async () => {
  const value = state(); value.connection!.phase = 'disconnected'; value.libraries!.phase = 'pending'; value.libraries!.pending = { projectId: libraryProjectId, ...libraryScope, actorId: libraryActor.id, requestId: draft.packet.requestId, libraryId: draft.packet.bundle.manifest.libraryId, revisionId: draft.packet.bundle.manifest.revisionId, name: draft.packet.bundle.manifest.name }; await render(value);
  expect(button('Recover publication').disabled).toBe(true); expect(button('Dismiss saved request').disabled).toBe(false); await act(async () => button('Dismiss saved request').click()); expect(host.dismiss).not.toHaveBeenCalled(); expect(container.textContent).toContain('already published to the room remains');
  await act(async () => button('Keep request').click()); expect(host.dismiss).not.toHaveBeenCalled(); await act(async () => button('Dismiss saved request').click()); await act(async () => button('Confirm dismissal').click()); expect(host.dismiss).toHaveBeenCalledOnce(); expect(host.refresh).not.toHaveBeenCalled(); expect(host.recover).not.toHaveBeenCalled();
});
it('closes a reviewed publication on a source change and disables all competing room controls while busy', async () => {
  await render(); await act(async () => button('Publish to room').click()); expect(container.querySelector('[role="dialog"]')).toBeTruthy(); const value = state(); value.preference!.serverUrl = 'https://other.example.test/'; await render(value); expect(container.querySelector('[role="dialog"]')).toBeNull();
  value.libraries!.phase = 'reading'; await render(value); expect(button('Reading…').disabled).toBe(true); expect(button('Publish to room').disabled).toBe(true); expect(host.publish).not.toHaveBeenCalled();
});
