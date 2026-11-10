import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn(), recover: vi.fn(), remove: vi.fn(), toast: vi.fn(), desktop: true, transitioning: false }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => host.desktop }));
vi.mock('./projectAssetImport', () => ({ interruptedProjectImports: host.list }));
vi.mock('@/components/ConfirmModal', () => ({ confirmAction: host.confirm }));
vi.mock('@/store/toastStore', () => ({ toast: { info: host.toast } }));
vi.mock('./projectsStore', () => ({ useXDProjects: Object.assign((select: (state: unknown) => unknown) => select({ transitioning: host.transitioning }), { getState: () => ({ transitioning: host.transitioning, recoverDesignImport: host.recover, removeInterruptedImport: host.remove }) }) }));
import { ProjectImportRecovery } from './ProjectImportRecovery';
const receipt = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' };
const saved = { ...receipt, phase: 'staged', name: 'Saved artwork', canOpen: true };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); host.desktop = true; host.transitioning = false;
  host.list.mockReset().mockResolvedValue([saved]); host.confirm.mockReset().mockResolvedValue(false); host.recover.mockReset().mockResolvedValue(receipt.projectId); host.remove.mockReset().mockResolvedValue('removed');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<ProjectImportRecovery />); }); }
function button(label: string) { return [...container.querySelectorAll('button')].find(button => button.textContent === label)!; }
async function click(label: string) { await act(async () => { button(label).click(); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it('shows named recovery rows with native keyboard controls and disables opening unfinished copies', async () => {
  host.list.mockResolvedValue([saved, { ...saved, projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', name: null, phase: 'preparing', canOpen: false }]); await mount();
  expect(container.querySelector('section')!.getAttribute('aria-label')).toBe('Interrupted copies'); expect(container.textContent).toContain('Saved artwork'); expect(container.textContent).toContain('Copy preparation did not finish.');
  const opens = [...container.querySelectorAll('button')].filter(button => button.textContent === 'Open recovered copy');
  expect(opens[0]!.disabled).toBe(false); expect(opens[1]!.disabled).toBe(true); opens[0]!.focus(); expect(document.activeElement).toBe(opens[0]);
  expect(opens[0]!.getAttribute('aria-label')).toBe('Open recovered copy: Saved artwork');
  expect(opens[1]!.getAttribute('aria-label')).toContain('Interrupted copy from'); expect(opens[0]!.getAttribute('aria-label')).not.toBe(opens[1]!.getAttribute('aria-label'));
  expect(host.list).toHaveBeenCalledOnce(); expect(host.recover).not.toHaveBeenCalled(); expect(host.remove).not.toHaveBeenCalled();
});
it('hides an empty recovery section and leaves browser-only sessions alone', async () => {
  host.list.mockResolvedValue([]); await mount(); expect(container.textContent).toBe('');
  act(() => root.unmount()); root = createRoot(container); host.desktop = false; host.list.mockClear(); await mount(); expect(host.list).not.toHaveBeenCalled(); expect(container.textContent).toBe('');
});
it('shows failed discovery with a usable refresh action and recovers after retry', async () => {
  host.list.mockRejectedValueOnce(new Error('Recovery list unavailable')); await mount(); expect(container.querySelector('[role="alert"]')!.textContent).toContain('Recovery list unavailable'); expect(button('Refresh').disabled).toBe(false);
  await click('Refresh'); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Saved artwork'); expect(host.list).toHaveBeenCalledTimes(2);
});
it('opens the selected original receipt once while repeated clicks and refresh are blocked', async () => {
  const pending = deferred<string>(); host.recover.mockReturnValue(pending.promise); await mount();
  await act(async () => { button('Open recovered copy').click(); button('Open recovered copy').click(); });
  expect(host.recover).toHaveBeenCalledExactlyOnceWith(receipt); expect(button('Refresh').disabled).toBe(true); expect(button('Remove unused copy…').disabled).toBe(true); expect(container.textContent).toContain('Opening saved copy…');
  await act(async () => { pending.resolve(receipt.projectId); }); expect(host.list).toHaveBeenCalledOnce();
});
it('does not remove on cancellation and refreshes after confirmed cleanup', async () => {
  await mount(); await click('Remove unused copy…'); expect(host.remove).not.toHaveBeenCalled();
  host.confirm.mockResolvedValueOnce(true); host.list.mockResolvedValueOnce([]); await click('Remove unused copy…'); expect(host.remove).toHaveBeenCalledExactlyOnceWith(receipt); expect(host.toast).toHaveBeenCalledWith('Unused copy removed'); expect(container.textContent).toBe('');
});
it('finishes interrupted removal and reports a copy kept because it became a saved project', async () => {
  host.list.mockResolvedValueOnce([{ ...saved, phase: 'discarded', canOpen: false }]).mockResolvedValueOnce([]); host.confirm.mockResolvedValue(true); host.remove.mockResolvedValue('kept'); await mount();
  expect(button('Open recovered copy').disabled).toBe(true); await click('Finish removing copy'); expect(host.toast).toHaveBeenCalledWith('This copy was saved as a project and was kept.'); expect(container.textContent).toBe('');
});
it('retains failed recovery rows and escapes names as text', async () => {
  host.list.mockResolvedValue([{ ...saved, name: '<script>copied artwork</script>' }]); host.recover.mockRejectedValue(new Error('Changed files were preserved')); await mount();
  expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('strong')!.textContent).toBe('<script>copied artwork</script>'); await click('Open recovered copy');
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('Changed files were preserved'); expect(button('Open recovered copy').disabled).toBe(false); expect(host.remove).not.toHaveBeenCalled();
});
it('abandons removal after the panel unmounts while confirmation is pending', async () => {
  const confirmation = deferred<boolean>(); host.confirm.mockReturnValue(confirmation.promise); await mount(); await act(async () => { button('Remove unused copy…').click(); });
  act(() => root.unmount()); root = createRoot(container); await act(async () => { confirmation.resolve(true); }); expect(host.remove).not.toHaveBeenCalled(); expect(host.toast).not.toHaveBeenCalled();
});
it('discovers newly interrupted copies after a home operation ends and respects transition admission', async () => {
  host.list.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]); await mount(); host.transitioning = true; await mount(); expect(host.list).toHaveBeenCalledOnce();
  host.transitioning = false; await mount(); expect(host.list).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('Saved artwork');
});
