import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ invoke: vi.fn(), data: new Map<string, unknown>(), confirm: vi.fn(), commits: vi.fn(), toast: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: host.invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));
vi.mock('@/lib/db', () => ({ getAppState: async (key: string) => host.data.get(key) ?? null, setAppState: async (key: string, value: unknown) => { host.data.set(key, value); }, setXDesignStateAtomic: host.commits }));
vi.mock('@/components/ConfirmModal', () => ({ confirmAction: host.confirm }));
vi.mock('@/store/toastStore', () => ({ toast: { info: host.toast, error: host.toast } }));
vi.mock('./ProjectThumb', () => ({ ProjectThumb: () => <span>Project preview</span> }));
import { XDesignHome } from './XDesignHome';
import { useXDProjects, emptyDoc } from './projectsStore';
import { useXDesign } from './store';
import { useHtmlArtifact } from './htmlArtifactStore';
const receipt = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' };
let root: Root, container: HTMLDivElement;
function Workspace() {
  const id = useXDProjects(state => state.activeId);
  return id ? <output aria-label="Opened recovered project">{id}</output> : <XDesignHome />;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); host.data.clear(); host.invoke.mockReset(); host.confirm.mockResolvedValue(true);
  useXDProjects.setState({ ready: true, transitioning: false, registry: [], openTabs: [], activeId: null, loadError: null }); useXDesign.getState().hydrate(emptyDoc()); useHtmlArtifact.getState().setProject(null);
  host.commits.mockReset().mockImplementation(async writes => { for (const { key, value } of writes) host.data.set(key, structuredClone(value)); });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<Workspace />); }); }
async function click(label: string) { await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click(); }); }
it('opens a post-restart copy from the actual home controls through the typed controller and real project stores', async () => {
  const document = { ...emptyDoc(), pages: [{ id: 'restored-page', name: 'Recovered artwork', shapes: [], past: [], future: [] }], activePageId: 'restored-page' };
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_preview_list') return {};
    expect(command).toBe('xdesign_project_import_control'); const { operation } = args;
    if (operation.kind === 'list') return { version: 1, imports: [{ ...receipt, phase: 'staged', name: 'Poster copy', canOpen: true }] };
    expect(operation).toEqual({ kind: 'status', ...receipt }); return { version: 1, ...receipt, phase: 'staged', imported: { name: 'Poster copy', document }, registry: null };
  });
  await mount(); expect(container.textContent).toContain('Start something new'); expect(container.textContent).toContain('Poster copy'); await click('Open recovered copy');
  expect(container.querySelector('output')!.textContent).toBe(receipt.projectId); expect(useXDesign.getState().activePageId).toBe('restored-page'); expect(host.data.get(`xdesign.project.${receipt.projectId}`)).toEqual(document);
  expect(host.commits).toHaveBeenCalledExactlyOnceWith(expect.any(Array), receipt); expect(host.invoke.mock.calls.filter(([command]) => command === 'xdesign_project_import_control').map(([, args]) => args.operation.kind)).toEqual(['list', 'status']);
});
it('keeps a project registered elsewhere after the recovery list loaded and displays it in Recent', async () => {
  const meta = { id: receipt.projectId, name: 'Saved by another window', createdAt: 1, updatedAt: 2 }; let registered = false;
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_preview_list') return {}; const { operation } = args;
    if (operation.kind === 'list') return { version: 1, imports: registered ? [] : [{ ...receipt, phase: 'staged', name: 'Poster copy', canOpen: true }] };
    expect(operation).toEqual({ kind: 'discard', ...receipt }); registered = true; host.data.set(`xdesign.project.${meta.id}`, emptyDoc()); host.data.set('xdesign.projects', { registry: [meta] });
    return { version: 1, ...receipt, phase: 'committed', imported: { name: meta.name, document: emptyDoc() }, registry: [meta] };
  });
  await mount(); await click('Remove unused copy…'); expect(container.querySelector('section[aria-label="Interrupted copies"]')).toBeNull(); expect(container.textContent).toContain('Recent'); expect(container.textContent).toContain('Saved by another window');
  expect(useXDProjects.getState().activeId).toBeNull(); expect(host.commits).not.toHaveBeenCalled(); expect(host.toast).toHaveBeenCalledWith('This copy was saved as a project and was kept.'); expect(host.data.has(`xdesign.project.${meta.id}`)).toBe(true);
});
