import { createPublicationRevision } from "./libraryDependencies";
import {
  assertLibraryId, assertLibraryAssetKey, contentHash,
  validateLibraryRevision, type ComponentLibraryManifest, type ComponentLibraryRevision,
  type LibraryCatalog, type LibrarySummary, type PublishLibraryInput,
} from "@open-pencil/core/library";
import { getAppState, compareAndSetXDesignLibraries } from "@/lib/db";
import { deserializeGraph, serializeGraph } from "./document";

type StoredRevision = { manifest: ComponentLibraryManifest; graph: string; checksum: string };
type StoredLibrary = { libraryId: string; sourceProjectId: string | null; latestRevisionId: string; revisions: StoredRevision[] };
type LibraryState = { formatVersion: 1; libraries: StoredLibrary[] };
export type LibraryStorage = { read(): Promise<unknown>; write(state: LibraryState, expected: unknown): Promise<void> };
export type LibraryRevisionSummary = { revisionId: string; previousRevisionId: string | null; name: string; description: string; publishedAt: string; assetCount: number; step: number };
const MAX_CATALOG_BYTES = 96 * 1024 * 1024;
const MAX_REVISIONS = 500;
const empty = (): LibraryState => ({ formatVersion: 1, libraries: [] });

function decodeState(value: unknown): LibraryState {
  if (value === null) return empty();
  const fail = (): never => { throw new Error("Saved component libraries are invalid. Restore a database backup; they have not been overwritten."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const state = value as LibraryState;
  if (state.formatVersion !== 1 || !Array.isArray(state.libraries) || state.libraries.length > 256 || new TextEncoder().encode(JSON.stringify(value)).length > MAX_CATALOG_BYTES) return fail();
  const ids = new Set<string>(); let count = 0;
  for (const library of state.libraries) {
    if (!library || typeof library.libraryId !== "string" || ids.has(library.libraryId) || !(library.sourceProjectId === null || typeof library.sourceProjectId === "string") || !Array.isArray(library.revisions) || !library.revisions.length) return fail();
    assertLibraryId(library.libraryId); ids.add(library.libraryId);
    const revisions = new Set<string>();
    for (const revision of library.revisions) {
      const m = revision?.manifest;
      if (!m || m.schemaVersion !== 1 || m.libraryId !== library.libraryId || typeof m.revisionId !== "string" || !/^[a-f0-9]{64}$/.test(m.revisionId) || revisions.has(m.revisionId) || !(m.previousRevisionId === null || revisions.has(m.previousRevisionId)) || typeof m.name !== "string" || !m.name.trim() || typeof m.description !== "string" || typeof m.publishedAt !== "string" || !Array.isArray(m.assets) || m.assets.length > 10_000 || typeof revision.graph !== "string" || typeof revision.checksum !== "string") return fail();
      const keys = new Set<string>();
      for (const asset of m.assets) {
        if (!asset || typeof asset.key !== "string" || keys.has(asset.key) || !["COMPONENT", "COMPONENT_SET"].includes(asset.type) || typeof asset.sourceNodeId !== "string" || typeof asset.name !== "string" || typeof asset.description !== "string" || typeof asset.contentHash !== "string") return fail();
        assertLibraryAssetKey(asset.key); keys.add(asset.key);
      }
      revisions.add(m.revisionId); count++;
    }
    if (library.latestRevisionId !== library.revisions.at(-1)!.manifest.revisionId) return fail();
  }
  if (count > MAX_REVISIONS) return fail();
  return structuredClone(state);
}

/** Immutable revisions in Orion's SQLite app state. A failed write never advances the catalog. */
export class OrionLibraryCatalog implements LibraryCatalog {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private storage: LibraryStorage = {
    read: () => getAppState("xdesign.libraries", true),
    write: (state, expected) => compareAndSetXDesignLibraries(state, expected),
  }) {}
  private async read(): Promise<LibraryState> { return decodeState(await this.storage.read()); }
  compactRevisions():Promise<{beforeBytes:number;afterBytes:number;revisions:number}> {
    const work=this.mutation.catch(()=>undefined).then(async()=>{
      const rawBefore=await this.storage.read(),state=decodeState(rawBefore),beforeBytes=new TextEncoder().encode(JSON.stringify(rawBefore)).length;let revisions=0;
      for(const library of state.libraries)for(const revision of library.revisions){
        if(await contentHash({graph:revision.graph})!==revision.checksum)throw new Error("A saved library revision failed its integrity check; compaction was cancelled");
        const graph=deserializeGraph(revision.graph,true);await validateLibraryRevision({manifest:revision.manifest,graph});
        const packed=serializeGraph(graph);if(packed!==revision.graph&&new TextEncoder().encode(packed).length<new TextEncoder().encode(revision.graph).length){revision.graph=packed;revision.checksum=await contentHash({graph:packed});revisions++;}
      }
      const afterBytes=new TextEncoder().encode(JSON.stringify(state)).length;
      if(revisions){if(afterBytes>MAX_CATALOG_BYTES)throw new Error("Compacted component libraries exceed the storage limit");await this.storage.write(state,rawBefore);}
      return {beforeBytes,afterBytes,revisions};
    });this.mutation=work;return work;
  }
  async listLibraries(): Promise<LibrarySummary[]> {
    const state = await this.read();
    return state.libraries.map(library => {
      const m = library.revisions.at(-1)!.manifest;
      return { libraryId: m.libraryId, name: m.name, latestRevisionId: m.revisionId, publishedAt: m.publishedAt, assetCount: m.assets.length };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listRevisions(libraryId: string): Promise<LibraryRevisionSummary[]> {
    assertLibraryId(libraryId);
    const library = (await this.read()).libraries.find(item => item.libraryId === libraryId);
    if (!library) throw new Error("The saved library revision could not be found");
    const summaries: LibraryRevisionSummary[] = [];
    let previousRevisionId: string | null = null;
    for (let index = 0; index < library.revisions.length; index++) {
      const stored = library.revisions[index]!;
      if (stored.manifest.previousRevisionId !== previousRevisionId) throw new Error("The saved library revision history has a broken predecessor chain");
      if (await contentHash({ graph: stored.graph }) !== stored.checksum) throw new Error("The saved library revision failed its integrity check");
      const revision = { manifest: structuredClone(stored.manifest), graph: deserializeGraph(stored.graph, true) };
      await validateLibraryRevision(revision);
      const manifest = revision.manifest;
      summaries.push({ revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length, step: index + 1 });
      previousRevisionId = manifest.revisionId;
    }
    return summaries;
  }
  async sourceProject(libraryId: string): Promise<string | null> {
    return (await this.read()).libraries.find(l => l.libraryId === libraryId)?.sourceProjectId ?? null;
  }
  async getRevision(libraryId: string, revisionId?: string): Promise<ComponentLibraryRevision> {
    assertLibraryId(libraryId);
    const library = (await this.read()).libraries.find(l => l.libraryId === libraryId);
    const stored = library?.revisions.find(r => r.manifest.revisionId === (revisionId ?? library.latestRevisionId));
    if (!stored) throw new Error("The saved library revision could not be found");
    if (await contentHash({ graph: stored.graph }) !== stored.checksum) throw new Error("The saved library revision failed its integrity check");
    const revision = { manifest: structuredClone(stored.manifest), graph: deserializeGraph(stored.graph, true) };
    await validateLibraryRevision(revision);
    return revision;
  }
  publishRevision(input: PublishLibraryInput, sourceProjectId: string | null = null): Promise<ComponentLibraryRevision> {
    const work = this.mutation.catch(() => undefined).then(async () => {
      assertLibraryId(input.libraryId);
      if (!input.name.trim() || input.name.length > 200 || (input.description?.length ?? 0) > 4000) throw new Error("Enter a library name up to 200 characters and a description up to 4,000 characters");
      const rawBefore = await this.storage.read();
      const before = decodeState(rawBefore);
      const existing = before.libraries.find(l => l.libraryId === input.libraryId);
      if ((existing?.latestRevisionId ?? null) !== (input.previousRevisionId ?? null)) throw new Error("This library has a newer revision. Refresh before publishing.");
      if (existing && existing.sourceProjectId !== sourceProjectId) throw new Error("Publish changes from the library's original project, or save a new library");
      const revision = await createPublicationRevision(input);
      // Upstream snapshots omit variable dependencies and geometry image bytes.
      // Orion publishes namespaced dependencies, then keeps those exact resources.
      revision.graph.variables = structuredClone(input.graph.variables);
      revision.graph.variableCollections = structuredClone(input.graph.variableCollections);
      revision.graph.activeMode = new Map(input.graph.activeMode);
      revision.graph.documentColorSpace = input.graph.documentColorSpace;
      const hashes = new Set([...revision.graph.nodes.values()].flatMap(n => [...n.fills, ...n.fillGeometry.flatMap(g => g.fills ?? [])].flatMap(f => f.type === "IMAGE" && f.imageHash ? [f.imageHash] : [])));
      for (const hash of hashes) {
        const bytes = input.graph.images.get(hash);
        if (!bytes) throw new Error("A component image is missing; restore it before publishing");
        revision.graph.images.set(hash, new Uint8Array(bytes));
      }
      await validateLibraryRevision(revision);
      const graph = serializeGraph(revision.graph);
      const stored: StoredRevision = { manifest: structuredClone(revision.manifest), graph, checksum: await contentHash({ graph }) };
      const next = structuredClone(before);
      const library = next.libraries.find(l => l.libraryId === input.libraryId);
      if (library) { library.revisions.push(stored); library.latestRevisionId = stored.manifest.revisionId; }
      else next.libraries.push({ libraryId: input.libraryId, sourceProjectId, latestRevisionId: stored.manifest.revisionId, revisions: [stored] });
      if (next.libraries.reduce((sum, l) => sum + l.revisions.length, 0) > MAX_REVISIONS || new TextEncoder().encode(JSON.stringify(next)).length > MAX_CATALOG_BYTES) throw new Error("Component libraries exceed the 96MB / 500 revision storage limit");
      // Re-read after asynchronous hashing: never silently publish over another writer.
      if (JSON.stringify(await this.read()) !== JSON.stringify(before)) throw new Error("Component libraries changed during publishing. Refresh and try again.");
      await this.storage.write(next, rawBefore);
      return { manifest: structuredClone(stored.manifest), graph: deserializeGraph(graph, true) };
    });
    this.mutation = work;
    return work;
  }
}

export const orionLibraryCatalog = new OrionLibraryCatalog();
