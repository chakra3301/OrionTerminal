import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: host.invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));
vi.mock('./projectsStore', async (original) => ({ ...await original<typeof import('./projectsStore')>(), loadDoc: vi.fn(async () => null) }));
import { XDesignHome } from './XDesignHome';
import { loadDoc, useXDProjects } from './projectsStore';
import { useProjectPreviews } from './projectPreview';
const A = '01ARZ3NDEKTSV4RRFFQ69G5FB0', C = '01ARZ3NDEKTSV4RRFFQ69G5FB2', F = '01ARZ3NDEKTSV4RRFFQ69G5FB3';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  host.invoke.mockReset().mockImplementation(async (command: string) => command === 'xdesign_preview_list' ? { [A]: { path: '/p/A.png', revision: 7 } } : { version: 1, imports: [] });
  useProjectPreviews.setState({ entries: {}, loaded: false });
  useXDProjects.setState({ ready: true, transitioning: false, openTabs: [], activeId: null, loadError: null, registry: [
    { id: A, name: 'A', createdAt: 1, updatedAt: 3 },
    { id: C, name: 'C', createdAt: 1, updatedAt: 2 },
    { id: F, name: 'F', createdAt: 1, updatedAt: 1, kind: 'fx' },
  ] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<XDesignHome />); }); }
const card = (name: string) => container.querySelector(`button[aria-label="Open ${name}"]`)!;
it("shows each project's stored preview, fitted, with its revision", async () => {
  await mount();
  const image = card('A').querySelector('img')!;
  expect(image.className).toBe('xd-home-card-image');
  expect(image.getAttribute('src')).toBe('/p/A.png?v=7');
});
it("keeps the old thumbnail without a preview, and when the file can't be shown", async () => {
  await mount();
  expect(card('C').querySelector('img')).toBeNull();
  expect(card('C').querySelector('.xd-thumb-svg, .xd-thumb-empty')).not.toBeNull();
  await act(async () => { card('A').querySelector('img')!.dispatchEvent(new Event('error')); });
  expect(card('A').querySelector('img')).toBeNull();
  expect(card('A').querySelector('.xd-thumb-svg, .xd-thumb-empty')).not.toBeNull();
});
it('only reads full documents for design projects that have no preview', async () => {
  await mount();
  expect(host.invoke).toHaveBeenCalledWith('xdesign_preview_list');
  expect(vi.mocked(loadDoc).mock.calls).toEqual([[C]]);
});
it('offers no 3D model start', async () => {
  await mount();
  expect(container.textContent).toContain('FX scene');
  expect(container.textContent).not.toMatch(/3D model|reference image into a 3D/i);
});
