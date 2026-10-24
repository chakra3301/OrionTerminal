import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryRevisionSummary } from './libraryCatalog';
import type { LibraryUpdateReview } from './librarySession';
import type { RoomUiState, CanvasRoomSession } from './roomSession';
const host = vi.hoisted(() => ({ list: vi.fn(), assets: vi.fn(), revisions: vi.fn(), review: vi.fn(), apply: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (value: string) => value }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn() }));
vi.mock('./runtime', async () => {
  const { create } = await import('zustand');
  return { usePencilWorkspace: create<{ editor: Editor | null; busy: boolean; readOnly: boolean; version: number }>(() => ({ editor: null, busy: false, readOnly: false, version: 0 })), executeDesignToolAsync: vi.fn(), runPencilLibraryAction: vi.fn(async (work: (session: { reviewUpdate: typeof host.review; applyUpdate: typeof host.apply }) => unknown) => work({ reviewUpdate: host.review, applyUpdate: host.apply })), libraryPhotoBytes: vi.fn() };
});
vi.mock('./librarySession', () => ({ pencilLibraries: () => ({ listLibraries: host.list, listComponents: host.assets, listRevisions: host.revisions }), publicationSelection: vi.fn() }));
vi.mock('./libraryCatalog', () => ({ orionLibraryCatalog: {} }));
vi.mock('./LibraryPreviewPanel', () => ({ LibraryPreviewPanel: () => null }));
import { usePencilWorkspace } from './runtime';
import { AssetsPanel } from './AssetsPanel';

const first = '1'.repeat(64), last = '2'.repeat(64), libraryId = 'orion-room-downloaded-controls';
const rows: LibraryRevisionSummary[] = [first, last].map((revisionId, index) => ({ revisionId, previousRevisionId: index ? first : null, name: 'Controls', description: '', publishedAt: '2026-10-14T00:00:00Z', step: index + 1, assetCount: 1 }));
const reviewed: LibraryUpdateReview = { libraryId, name: 'Controls', currentRevisionId: last, targetRevisionId: first, originalGraph: 'before', updatedGraph: 'after', changes: [], affectedInstanceCount: 1, fallbackInstanceCount: 0, removedInstanceCount: 0, discardedOverrideCount: 0 };
let root: Root, container: HTMLDivElement, editor: Editor;
const room = {} as CanvasRoomSession;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)!;
const click = async (name: string) => act(async () => { button(name).click(); });
const state = (documentId = 'document1'): RoomUiState => ({ preference: { documentId, serverUrl: 'https://room.example.test/', revision: 1, role: 'editor' }, opening: false, creation: null, connection: null, presence: null, error: null });
const draw = async (value = state()) => act(async () => root.render(<AssetsPanel room={room} roomState={value}/>));
const chooseFirst = async () => { if (button('Revision history')) await click('Revision history'); await act(async () => { const select = container.querySelector('select')!; select.value = first; select.dispatchEvent(new Event('change', { bubbles: true })); }); };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.values(host).forEach(mock => mock.mockReset());
  host.list.mockResolvedValue([{ libraryId, name: 'Controls', origin: 'room', latestRevisionId: last, publishedAt: rows[1]!.publishedAt, assetCount: 1 }]); host.assets.mockResolvedValue([]); host.revisions.mockResolvedValue(rows); host.review.mockResolvedValue(reviewed); host.apply.mockResolvedValue(undefined);
  editor = createEditor(); editor.graph.enabledLibraries.set(libraryId, { libraryId, revisionId: last, enabled: true }); usePencilWorkspace.setState({ editor, busy: false, readOnly: false, version: 0 });
  container = document.createElement('div'); container.className = 'xd-pencil'; document.body.append(container); root = createRoot(container); await draw();
});
afterEach(() => { act(() => root.unmount()); editor.dispose(); container.remove(); vi.unstubAllGlobals(); });

it('opens exact-target impact review before apply and shows full current and target identities', async () => {
  await chooseFirst(); expect(host.review).not.toHaveBeenCalled(); expect(host.apply).not.toHaveBeenCalled(); await click('Review revision');
  expect(host.review).toHaveBeenCalledExactlyOnceWith(libraryId, first); const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(`Current revision: ${last}`); expect(dialog.textContent).toContain(`Reviewed revision: ${first}`); expect(dialog.textContent).toContain('1 instances will update'); expect(host.apply).not.toHaveBeenCalled();
  await click('Apply reviewed update'); expect(host.apply).toHaveBeenCalledExactlyOnceWith(reviewed); expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('discards an awaited review after the room document changes and closes an existing review on source changes', async () => {
  let resolve!: (value: LibraryUpdateReview) => void; const pending = new Promise<LibraryUpdateReview>(yes => { resolve = yes; }); host.review.mockReturnValueOnce(pending);
  await chooseFirst(); await click('Review revision'); await draw(state('document2')); await act(async () => resolve(reviewed)); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(host.apply).not.toHaveBeenCalled();
  await chooseFirst(); await click('Review revision'); expect(container.querySelector('[role="dialog"]')).toBeTruthy(); await draw(state('document3')); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(host.apply).not.toHaveBeenCalled();
});
it('allows a viewer to browse cached history while preventing review or apply', async () => {
  await act(async () => usePencilWorkspace.setState({ readOnly: true })); await chooseFirst(); expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false); expect(button('Review revision').disabled).toBe(true); await click('Review revision'); expect(host.review).not.toHaveBeenCalled(); expect(host.apply).not.toHaveBeenCalled();
});
