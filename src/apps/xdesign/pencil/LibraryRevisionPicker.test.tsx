import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { LibraryRevisionSummary } from './libraryCatalog';
import type { PencilLibrarySummary } from './roomLibraryCatalog';
const host = vi.hoisted(() => ({ list: vi.fn(), session: vi.fn() }));
vi.mock('./librarySession', () => ({ pencilLibraries: host.session }));
import { LibraryRevisionPicker } from './LibraryRevisionPicker';

const first = '1'.repeat(64), last = '2'.repeat(64), third = '3'.repeat(64), editor = {} as Editor;
const library: PencilLibrarySummary = { libraryId: 'controls', name: 'Controls', origin: 'room', latestRevisionId: last, publishedAt: '2026-10-14T00:00:00Z', assetCount: 2 };
const rows: LibraryRevisionSummary[] = [
  { revisionId: first, previousRevisionId: null, name: 'Original controls', description: 'Original spacing', publishedAt: '2026-10-12T00:00:00Z', assetCount: 1, step: 1 },
  { revisionId: last, previousRevisionId: first, name: 'Controls', description: 'New spacing', publishedAt: library.publishedAt, assetCount: 2, step: 2 },
];
let container: HTMLDivElement, root: Root, props: Parameters<typeof LibraryRevisionPicker>[0], review: Mock<(revisionId: string) => Promise<void>>;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)!;
const click = async (name: string) => act(async () => { button(name).click(); });
const choose = async (id: string) => act(async () => { const select = container.querySelector('select')!; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); });
const draw = async (patch: Partial<typeof props> = {}) => act(async () => { props = { ...props, ...patch }; root.render(<LibraryRevisionPicker {...props}/>); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host.list.mockReset().mockResolvedValue(structuredClone(rows)); host.session.mockReset().mockReturnValue({ listRevisions: host.list });
  review = vi.fn<(revisionId: string) => Promise<void>>().mockResolvedValue(undefined); props = { editor, library, revisionId: last, enabled: true, busy: false, readOnly: false, sourceKey: 'room1', refreshKey: '0', review };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); await draw();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('loads downloaded metadata only after opening, selects the pinned revision and keeps selection read-only', async () => {
  expect(host.list).not.toHaveBeenCalled(); await click('Revision history'); expect(host.list).toHaveBeenCalledExactlyOnceWith('controls');
  const select = container.querySelector('select')!; expect(select.value).toBe(last); expect([...select.options].map(option => option.value)).toEqual([last, first]); expect(select.options[0]!.text).toContain('Current'); expect(button('Review revision').disabled).toBe(true);
  await choose(first); expect(container.textContent).toContain('Original spacing'); expect(container.textContent).toContain(first); expect(container.querySelector('time')?.dateTime).toBe(rows[0]!.publishedAt); expect(review).not.toHaveBeenCalled();
  await click('Hide revision history'); expect(container.querySelector('select')).toBeNull(); expect(review).not.toHaveBeenCalled();
});
it('reviews the exact older target and refuses duplicate submits while it prepares', async () => {
  const pending = deferred<void>(); review.mockReturnValue(pending.promise); await click('Revision history'); await choose(first); await click('Review revision');
  expect(review).toHaveBeenCalledExactlyOnceWith(first); expect(button('Preparing revision…').disabled).toBe(true); expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
  await click('Preparing revision…'); expect(review).toHaveBeenCalledTimes(1); await act(async () => pending.resolve()); expect(button('Review revision').disabled).toBe(false);
});
it.each([{ readOnly: true }, { enabled: false }, { busy: true }])('keeps revision browsing separate from unavailable artwork actions: %j', async flags => {
  await click('Revision history'); await choose(first); await draw(flags); expect(button('Review revision').disabled).toBe(true); await click('Review revision'); expect(review).not.toHaveBeenCalled();
  if ('readOnly' in flags && flags.readOnly) expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
});
it('retries a failed read without losing original history and handles synchronous session errors', async () => {
  host.session.mockImplementationOnce(() => { throw new Error('Canvas closed'); }); await click('Revision history'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Canvas closed'); expect(review).not.toHaveBeenCalled();
  await click('Retry revision history'); expect(container.querySelector('select')!.value).toBe(last); expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('discards history responses after source replacement or closing and reloads for the current source', async () => {
  const old = deferred<LibraryRevisionSummary[]>(); host.list.mockReturnValueOnce(old.promise); await click('Revision history'); expect(container.textContent).toContain('Loading revision history');
  await draw({ sourceKey: 'room2', library: { ...library, name: 'Second room' } }); expect(container.querySelector('select')!.value).toBe(last);
  await act(async () => old.resolve([{ ...rows[0]!, name: 'Foreign room history', revisionId: third }])); expect(container.textContent).not.toContain('Foreign room history'); expect(container.querySelector('select')!.value).toBe(last);
  const closed = deferred<LibraryRevisionSummary[]>(); host.list.mockReturnValueOnce(closed.promise); await click('Hide revision history'); await click('Revision history'); await click('Hide revision history'); await act(async () => closed.resolve(rows)); expect(container.querySelector('select')).toBeNull();
});
it('retains a rejected exact revision for retry and hides late review errors after context changes', async () => {
  review.mockRejectedValueOnce(new Error('Design changed')); await click('Revision history'); await choose(first); await click('Review revision'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Design changed'); expect(container.querySelector('select')!.value).toBe(first);
  const pending = deferred<void>(); review.mockReturnValueOnce(pending.promise); await click('Review revision'); await draw({ sourceKey: 'room2' }); await act(async () => pending.reject(new Error('Old room error'))); expect(container.textContent).not.toContain('Old room error');
});
it('resets selection to the new pinned revision after binding or cache refresh changes', async () => {
  await click('Revision history'); await choose(first); await draw({ revisionId: first }); expect(container.querySelector('select')!.value).toBe(first); expect(button('Review revision').disabled).toBe(true);
  host.list.mockResolvedValue([...rows, { ...rows[1]!, revisionId: third, previousRevisionId: last, step: 3 }]); await draw({ refreshKey: '1', library: { ...library, latestRevisionId: third } }); expect(container.querySelector('select')!.value).toBe(first); expect(container.querySelector('select')!.options[0]!.value).toBe(third); expect(review).not.toHaveBeenCalled();
});
