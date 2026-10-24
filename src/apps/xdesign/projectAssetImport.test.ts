import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
import { ProjectAssetImport, interruptedProjectImports, projectImportControl } from './projectAssetImport';
import type { XDDoc } from './projectsStore';
const projectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV', operationId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const receipt = { projectId, operationId };
const imported = { name: 'Copy', document: { pages: [], activePageId: 'page' } as XDDoc };
const reply = (phase: string) => ({ version: 1, ...receipt, phase, imported: phase === 'staged' || phase === 'committed' ? imported : null, registry: phase === 'committed' ? [] : null });
beforeEach(() => { native.invoke.mockReset(); });
it('passes the known receipt to one copy and rejects duplicate work', async () => {
  const operation = new ProjectAssetImport(projectId, operationId), copy = vi.fn(async () => imported);
  expect(operation.used).toBe(false); expect(await operation.run(copy)).toBe(imported);
  expect(copy).toHaveBeenCalledExactlyOnceWith(operationId); expect(operation.used).toBe(true);
  await expect(operation.run(copy)).rejects.toThrow('original asset import'); expect(native.invoke).not.toHaveBeenCalled();
});
it('recovers a lost native reply from the same staged result without copying again', async () => {
  native.invoke.mockResolvedValue(reply('staged'));
  const copy = vi.fn(async () => { throw new Error('Lost native reply'); });
  expect(await new ProjectAssetImport(projectId, operationId).run(copy)).toEqual(imported);
  expect(copy).toHaveBeenCalledOnce(); expect(native.invoke).toHaveBeenCalledExactlyOnceWith('xdesign_project_import_control', { operation: { kind: 'status', ...receipt } });
});
it('cleans an unused copy after failure and retains the original failure', async () => {
  const operation = new ProjectAssetImport(projectId, operationId); await operation.run(async () => imported);
  native.invoke.mockResolvedValue(reply('discarded'));
  const error = new Error('Registry save failed'); await expect(operation.afterFailure(error)).rejects.toBe(error);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith('xdesign_project_import_control', { operation: { kind: 'discard', ...receipt } });
});
it('returns canonical registered data after a lost commit reply', async () => {
  const operation = new ProjectAssetImport(projectId, operationId); await operation.run(async () => imported);
  native.invoke.mockResolvedValue(reply('committed')); expect(await operation.afterFailure(new Error('Lost save reply'))).toEqual(reply('committed'));
});
it('reports both the failed save and retained cleanup when native recovery refuses', async () => {
  const operation = new ProjectAssetImport(projectId, operationId); await operation.run(async () => imported);
  native.invoke.mockRejectedValue(new Error('Changed asset was preserved'));
  await expect(operation.afterFailure(new Error('Disk full'))).rejects.toThrow('Disk full. Import recovery requires review: Changed asset was preserved');
});
it('does not invoke cleanup for documents without native asset work', async () => {
  const error = new Error('Invalid design'); await expect(new ProjectAssetImport(projectId, operationId).afterFailure(error)).rejects.toBe(error); expect(native.invoke).not.toHaveBeenCalled();
});
it.each([
  { ...reply('staged'), operationId: projectId }, { ...reply('staged'), extra: true }, { ...reply('staged'), registry: [] },
  { ...reply('committed'), imported: null }, { ...reply('preparing'), imported }, { ...reply('discarded'), phase: 'unknown' },
])('rejects foreign or malformed recovery data %#', async value => {
  native.invoke.mockResolvedValue(value); await expect(projectImportControl(receipt, 'status')).rejects.toThrow();
});
it('lists only bounded, distinct pending receipts and refuses duplicates', async () => {
  const pending = { ...receipt, phase: 'staged', name: 'Saved copy', canOpen: true };
  native.invoke.mockResolvedValue({ version: 1, imports: [pending] }); expect(await interruptedProjectImports()).toEqual([pending]);
  native.invoke.mockResolvedValue({ version: 1, imports: [pending, pending] }); await expect(interruptedProjectImports()).rejects.toThrow('receipt');
  native.invoke.mockResolvedValue({ version: 1, imports: Array(65).fill(pending) }); await expect(interruptedProjectImports()).rejects.toThrow('list');
});
it('keeps interrupted cleanup receipts available for another discard attempt', async () => {
  const pending = { ...receipt, phase: 'discarded', name: 'Saved copy', canOpen: false };
  native.invoke.mockResolvedValue({ version: 1, imports: [pending] }); expect(await interruptedProjectImports()).toEqual([pending]);
});
it.each([
  { ...receipt, kind: 'discard' }, { ...receipt, extra: true }, { ...receipt, projectId: 123 },
])('rejects malformed receipts before invoking a read or removal %#', async value => {
  await expect(projectImportControl(value as never, 'status')).rejects.toThrow('identity'); expect(native.invoke).not.toHaveBeenCalled();
});
it.each([
  { ...receipt, phase: 'staged', name: '😀'.repeat(257), canOpen: true },
  { ...receipt, phase: 'discarded', name: 'Copy', canOpen: true },
  { ...receipt, phase: 'staged', name: null, canOpen: 'yes' },
  { ...receipt, phase: 'staged', name: 'Copy', canOpen: true, extra: true },
])('rejects malformed pending presentation metadata %#', async value => {
  native.invoke.mockResolvedValue({ version: 1, imports: [value] }); await expect(interruptedProjectImports()).rejects.toThrow('receipt');
});
