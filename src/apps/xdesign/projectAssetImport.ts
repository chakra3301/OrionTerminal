import { invoke } from '@tauri-apps/api/core';
import { ulid } from 'ulid';
import type { XDDoc } from './projectsStore';

export type ProjectImportReceipt = Readonly<{ projectId: string; operationId: string }>;
type Imported = { name: string; document: XDDoc };
export type ProjectImportResult = {
  version: 1;
  projectId: string;
  operationId: string;
  phase: 'preparing' | 'staged' | 'committed' | 'discarded';
  imported: Imported | null;
  registry: unknown[] | null;
};
export type InterruptedProjectImport = ProjectImportReceipt & {
  phase: 'preparing' | 'staged' | 'discarded';
  name: string | null;
  canOpen: boolean;
};

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
function validReceipt(value: ProjectImportReceipt): void {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'operationId,projectId' ||
    typeof value.projectId !== 'string' || typeof value.operationId !== 'string' ||
    !idPattern.test(value.projectId) || !idPattern.test(value.operationId)) throw new Error('Invalid project import identity');
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function result(value: unknown, receipt: ProjectImportReceipt): ProjectImportResult {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'imported,operationId,phase,projectId,registry,version' ||
    value.version !== 1 || value.projectId !== receipt.projectId || value.operationId !== receipt.operationId ||
    !['preparing', 'staged', 'committed', 'discarded'].includes(String(value.phase))) throw new Error('Invalid project import recovery reply; files were preserved');
  const ready = value.phase === 'staged' || value.phase === 'committed';
  if (ready ? !object(value.imported) || Object.keys(value.imported).sort().join(',') !== 'document,name' ||
    typeof value.imported.name !== 'string' || !object(value.imported.document) : value.imported !== null) throw new Error('Invalid recovered project data');
  if (value.phase === 'committed' ? !Array.isArray(value.registry) : value.registry !== null) throw new Error('Invalid recovered project registry');
  return value as ProjectImportResult;
}
export async function projectImportControl(receipt: ProjectImportReceipt, kind: 'status' | 'discard'): Promise<ProjectImportResult> {
  validReceipt(receipt);
  return result(await invoke('xdesign_project_import_control', { operation: { kind, projectId: receipt.projectId, operationId: receipt.operationId } }), receipt);
}
export async function interruptedProjectImports(): Promise<InterruptedProjectImport[]> {
  const raw = await invoke<unknown>('xdesign_project_import_control', { operation: { kind: 'list' } });
  if (!object(raw) || Object.keys(raw).sort().join(',') !== 'imports,version' || raw.version !== 1 || !Array.isArray(raw.imports) || raw.imports.length > 64) throw new Error('Invalid interrupted project list');
  const seen = new Set<string>();
  return raw.imports.map(value => {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'canOpen,name,operationId,phase,projectId' ||
      typeof value.projectId !== 'string' || typeof value.operationId !== 'string' ||
      (value.name !== null && (typeof value.name !== 'string' || value.name.length > 512 || [...value.name].length > 256 || !value.name.trim())) ||
      typeof value.canOpen !== 'boolean' || value.phase === 'discarded' && value.canOpen ||
      (value.phase !== 'preparing' && value.phase !== 'staged' && value.phase !== 'discarded') || seen.has(value.projectId)) throw new Error('Invalid interrupted project receipt');
    const receipt = { projectId: value.projectId, operationId: value.operationId };
    validReceipt(receipt); seen.add(receipt.projectId);
    return { ...receipt, phase: value.phase, name: value.name as string | null, canOpen: value.canOpen };
  });
}

export class ProjectAssetImport {
  readonly receipt: ProjectImportReceipt;
  private started = false;
  constructor(projectId: string, operationId = ulid()) {
    this.receipt = Object.freeze({ projectId, operationId }); validReceipt(this.receipt);
  }
  get used(): boolean { return this.started; }
  async run<T extends Imported>(copy: (operationId: string) => Promise<T>): Promise<T> {
    if (this.started) throw new Error('Recover the original asset import before starting another');
    this.started = true;
    try { return await copy(this.receipt.operationId); }
    catch (error) {
      try {
        const recovered = await projectImportControl(this.receipt, 'status');
        if (recovered.phase === 'staged') return recovered.imported as T;
      } catch { /* Cleanup below retains the original failure if recovery is unavailable. */ }
      throw error;
    }
  }
  async afterFailure(error: unknown): Promise<ProjectImportResult | null> {
    if (!this.started) throw error;
    try {
      const recovered = await projectImportControl(this.receipt, 'discard');
      if (recovered.phase === 'committed') return recovered;
      if (recovered.phase !== 'discarded') throw new Error('Import cleanup did not finish');
    } catch (cleanup) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}. Import recovery requires review: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`, { cause: error });
    }
    throw error;
  }
}
