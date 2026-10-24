import { ulid } from "ulid";
import { reapplyInstanceComponentProperties, type Editor } from "@open-pencil/core/editor";
import {
  diffLibraryManifests, findLibraryDefinition, libraryUpdateImpact,
  publishableLibraryRoots, readSourceLibraryPublication, writeSourceLibraryPublication,
  type ComponentLibraryRevision, type LibraryAssetChange, type LibraryInstanceUpdate,
} from "@open-pencil/core/library";
import { registerComponentCatalog, type ComponentCatalog, type ComponentCatalogInsertInput, type ComponentCatalogLibraryAsset } from "@open-pencil/core/tools";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";
import { orionLibraryCatalog } from "./libraryCatalog";
import { deserializeGraph, serializeGraph } from "./document";
import { installLibraryResources, prepareLibrarySource, type LibraryPhotoLoader, type LibraryRoomImageLoader } from "./libraryResources";
import { applyPencilGraphSnapshot, editPencilGraph } from "./toolExecution";
import { normalizeLibraryNestedInstances, swapLibraryInstance } from "./libraryOverrides";
import { createPublicationRevision, materializePublicationAsset } from "./libraryDependencies";
import { roomAwareLibraryCatalog, type PencilLibraryCatalog } from './roomLibraryCatalog';
import type { LibraryRevisionSummary } from './libraryCatalog';

export type PublicationDraft = {
  libraryId: string; name: string; description: string; previousRevisionId: string | null;
  sourceGraph: SceneGraph; originalGraph: string; rootIds: string[];
  assignments: { nodeId: string; assetKey: string }[]; changes: LibraryAssetChange[];
  revisionId: string;
};
export type LibraryUpdateReview = {
  libraryId: string; name: string; currentRevisionId: string; targetRevisionId: string;
  originalGraph: string; updatedGraph: string; changes: LibraryAssetChange[];
  affectedInstanceCount: number; fallbackInstanceCount: number; removedInstanceCount: number; discardedOverrideCount: number;
};

type IssuedReview = { owner: PencilLibrarySession; contextGuard?: () => void; fingerprint: string };
const issuedReviews = new WeakMap<LibraryUpdateReview, IssuedReview>();

/** Remember the last chosen publication roots when the source canvas is reopened. */
export function publicationSelection(graph: SceneGraph): Set<string> {
  const roots=publishableLibraryRoots(graph),publication=readSourceLibraryPublication(graph);
  const entry=graph.getNode(graph.rootId)?.pluginData.find(item=>item.pluginId==="orion-xdesign"&&item.key==="publishedLibraryAssets");
  if(entry&&publication)try {
    const saved:unknown=JSON.parse(entry.value);
    if(saved&&typeof saved==="object"&&"libraryId" in saved&&saved.libraryId===publication.libraryId&&"assetKeys" in saved&&Array.isArray(saved.assetKeys)&&saved.assetKeys.every(key=>typeof key==="string")) {
      const keys=new Set(saved.assetKeys);return new Set(roots.filter(root=>root.componentKey&&keys.has(root.componentKey)).map(root=>root.id));
    }
  }catch{/* Older source metadata defaults to all local roots. */}
  return new Set(roots.map(root=>root.id));
}

function libraryIdentity(graph: SceneGraph, componentId: string) {
  let node = graph.getNode(componentId);
  const parent = node?.parentId ? graph.getNode(node.parentId) : null;
  if (parent?.type === "COMPONENT_SET" && parent.librarySource) return parent.librarySource.identity;
  while (node) {
    if (node.librarySource) return node.librarySource.identity;
    node = node.parentId ? graph.getNode(node.parentId) : undefined;
  }
  return null;
}
export function isLibraryDefinition(graph: SceneGraph, node: SceneNode) {
  let ancestor: SceneNode | undefined = node;
  while (ancestor) { if (ancestor.internalOnly || ancestor.librarySource?.readOnly) return true; ancestor = ancestor.parentId ? graph.getNode(ancestor.parentId) : undefined; }
  return false;
}
function linkedInstances(graph: SceneGraph, libraryId: string) {
  return [...graph.nodes.values()].filter(node => node.type === "INSTANCE" && node.componentId && libraryIdentity(graph, node.componentId)?.libraryId === libraryId && !isLibraryDefinition(graph, node)).filter(node => {
    // Parent library swaps already rebuild their inherited nested instances.
    let parent = node.parentId ? graph.getNode(node.parentId) : undefined;
    while (parent) { if (parent.type === "INSTANCE" && parent.componentId && libraryIdentity(graph, parent.componentId)?.libraryId === libraryId) return false; parent = parent.parentId ? graph.getNode(parent.parentId) : undefined; }
    return true;
  });
}
function updatePlans(graph: SceneGraph, latest: ComponentLibraryRevision): { plans: LibraryInstanceUpdate[]; removed: number } {
  const plans: LibraryInstanceUpdate[] = []; let removed = 0;
  for (const instance of linkedInstances(graph, latest.manifest.libraryId)) {
    const component = graph.getNode(instance.componentId!)!;
    const identity = libraryIdentity(graph, component.id)!;
    if (identity.revisionId === latest.manifest.revisionId) continue;
    const root = findLibraryDefinition(graph, identity.libraryId, identity.assetKey, latest.manifest.revisionId);
    if (!root) { removed++; continue; }
    const candidates = root.type === "COMPONENT" ? [root] : graph.getChildren(root.id).filter(n => n.type === "COMPONENT");
    const exact = candidates.find(c => Object.keys(c.componentPropertyValues).length === Object.keys(component.componentPropertyValues).length && Object.entries(component.componentPropertyValues).every(([name, value]) => c.componentPropertyValues[name] === value));
    const target = exact ?? candidates.sort((a, b) => a.y - b.y || a.x - b.x)[0];
    if (!target) throw new Error("An updated component set contains no variants");
    plans.push({ instanceId: instance.id, previousComponentId: component.id, componentId: target.id, fallback: !exact });
  }
  return { plans, removed };
}

/** Per-canvas adapter; the UI and Orion tools use the same catalog and revision rules. */
export class PencilLibrarySession implements ComponentCatalog {
  private disposed = false;
  private unregister: () => void;
  constructor(
    readonly editor: Editor, readonly projectId: string,
    readonly catalog: PencilLibraryCatalog = orionLibraryCatalog,
    private ensureActive: () => void = () => undefined,
  ) { this.unregister = registerComponentCatalog(editor.graph, this); }
  dispose() { this.disposed = true; this.unregister(); }
  private guard() { if (this.disposed) throw new Error("The library's design canvas has closed"); this.ensureActive(); }
  private reviewContextGuard() { return this.catalog.captureReviewGuard?.(); }
  async listRevisions(libraryId: string): Promise<LibraryRevisionSummary[]> {
    this.guard(); const contextGuard = this.reviewContextGuard(); contextGuard?.();
    const revisions = await this.catalog.listRevisions(libraryId);
    this.guard(); contextGuard?.();
    let previousRevisionId: string | null = null;
    if (!Array.isArray(revisions) || revisions.some((revision, index) => {
      const valid = revision && typeof revision.revisionId === "string" && !!revision.revisionId && revision.previousRevisionId === previousRevisionId && revision.step === index + 1 && typeof revision.name === "string" && typeof revision.description === "string" && typeof revision.publishedAt === "string" && Number.isSafeInteger(revision.assetCount) && revision.assetCount >= 0;
      if (valid) previousRevisionId = revision.revisionId;
      return !valid;
    })) throw new Error("The library returned invalid revision history");
    return revisions;
  }
  async listLibraries() { this.guard(); const result = await this.catalog.listLibraries(); this.guard(); return result; }
  async listComponents(input: { name?: string; libraryId?: string; enabledOnly?: boolean } = {}): Promise<ComponentCatalogLibraryAsset[]> {
    const libraries = await this.listLibraries(); const result: ComponentCatalogLibraryAsset[] = [];
    for (const summary of libraries) {
      if (input.libraryId && input.libraryId !== summary.libraryId) continue;
      const binding = this.editor.graph.enabledLibraries.get(summary.libraryId);
      if (input.enabledOnly && !binding?.enabled) continue;
      const revision = await this.catalog.getRevision(summary.libraryId, binding?.revisionId ?? summary.latestRevisionId); this.guard();
      for (const asset of revision.manifest.assets) if (!input.name || `${asset.name} ${asset.description}`.toLowerCase().includes(input.name.toLowerCase())) result.push({ libraryId: summary.libraryId, libraryName: summary.name, revisionId: revision.manifest.revisionId, enabled: binding?.enabled ?? false, priority: 0, asset });
    }
    return result;
  }
  /** Caller owns the async graph transaction, including materialized definitions and tokens. */
  async insertComponent(input: ComponentCatalogInsertInput): Promise<{ id: string; componentId: string }> {
    this.guard(); const binding = this.editor.graph.enabledLibraries.get(input.libraryId);
    if (binding && !binding.enabled) throw new Error("Enable this component library before inserting an instance");
    if (binding && input.revisionId && input.revisionId !== binding.revisionId) throw new Error("Review the library update before inserting a different revision");
    const revision = await this.catalog.getRevision(input.libraryId, input.revisionId ?? binding?.revisionId); this.guard();
    const parentId = input.parentId ?? this.editor.state.currentPageId;
    const parent = this.editor.graph.getNode(parentId);
    if (!parent || !["CANVAS", "FRAME", "GROUP", "SECTION", "COMPONENT", "INSTANCE"].includes(parent.type) || isLibraryDefinition(this.editor.graph, parent)) throw new Error("Choose an editable page, frame or group for the component");
    installLibraryResources(this.editor.graph, revision);
    const materialized = materializePublicationAsset(this.editor.graph, revision, input.assetKey);
    let componentId = materialized.componentId;
    if (input.variantValues) {
      if (!materialized.componentSetId) throw new Error("This component has no variants");
      const match = this.editor.findVariantByValues(materialized.componentSetId, input.variantValues);
      if (!match) throw new Error("The requested variant combination does not exist"); componentId = match.id;
    }
    const instance = this.editor.graph.createInstance(componentId, parentId, { x: input.x ?? 100, y: input.y ?? 100 });
    if (!instance) throw new Error("The library component could not be inserted");
    normalizeLibraryNestedInstances(this.editor.graph,instance.id);
    reapplyInstanceComponentProperties(this.editor, instance.id);
    if (this.editor.graph.nodes.size > 10_000) throw new Error("Library insertion exceeds the 10,000-layer transaction limit");
    this.editor.select([instance.id]); this.editor.requestRender();
    return { id: instance.id, componentId };
  }
  async setEnabled(libraryId: string, enabled: boolean) {
    this.guard(); const binding = this.editor.graph.enabledLibraries.get(libraryId);
    const revision = await this.catalog.getRevision(libraryId, binding?.revisionId); this.guard();
    editPencilGraph(this.editor, enabled ? "Enable component library" : "Disable component library", () => {
      this.editor.graph.enabledLibraries.set(libraryId, { libraryId, revisionId: revision.manifest.revisionId, enabled });
    });
  }
  async preparePublication(name: string, description: string, saveAsNew = false, loadPhoto?: LibraryPhotoLoader, selectedRootIds?: readonly string[], loadRoomImage?: LibraryRoomImageLoader): Promise<PublicationDraft> {
    this.guard(); if (!name.trim()) throw new Error("Enter a library name");
    const originalGraph = serializeGraph(this.editor.graph);
    const publication = saveAsNew ? null : readSourceLibraryPublication(this.editor.graph);
    const libraryId = publication?.libraryId ?? `orion-${ulid()}`;
    const roots = publishableLibraryRoots(this.editor.graph);
    const selected = selectedRootIds === undefined ? null : new Set(selectedRootIds);
    if (selected && (selected.size !== selectedRootIds!.length || [...selected].some(id => !roots.some(root => root.id === id)))) throw new Error("Choose available local components or complete component sets to publish");
    const rootIds = roots.filter(root => !selected || selected.has(root.id)).map(n => n.id);
    if (!rootIds.length && !publication) throw new Error("Create a component before publishing a library");
    const { graph, assignments } = await prepareLibrarySource(this.editor.graph, libraryId, rootIds, loadPhoto, name.trim(), loadRoomImage); this.guard();
    const previous = publication ? await this.catalog.getRevision(libraryId) : null; this.guard();
    const revision = await createPublicationRevision({ libraryId, name, description, graph, assetNodeIds: rootIds, previousRevisionId: previous?.manifest.revisionId ?? null }); this.guard();
    if (serializeGraph(this.editor.graph) !== originalGraph) throw new Error("The design changed during publication review. Review it again.");
    return { libraryId, name: name.trim(), description, previousRevisionId: previous?.manifest.revisionId ?? null, sourceGraph: graph, originalGraph, rootIds, assignments, changes: previous ? diffLibraryManifests(previous.manifest, revision.manifest) : revision.manifest.assets.map(asset => ({ kind: "added" as const, asset })), revisionId: revision.manifest.revisionId };
  }
  async publish(draft: PublicationDraft) {
    this.guard(); if (serializeGraph(this.editor.graph) !== draft.originalGraph) throw new Error("The design changed. Review the library before publishing.");
    if (this.editor.graph.nodes.size > 10_000) throw new Error("Library publishing exceeds the 10,000-layer transaction limit");
    const applyMetadata = (graph: SceneGraph, revisionId: string) => {
      for (const assignment of draft.assignments) { const node=graph.getNode(assignment.nodeId)!;if(!isLibraryDefinition(graph,node))graph.updateNode(node.id, { componentKey: assignment.assetKey }); }
      writeSourceLibraryPublication(graph, { libraryId: draft.libraryId, revisionId, name: draft.name, catalogSource: "orion-local" });
      const root=graph.getNode(graph.rootId)!;
      graph.updateNode(root.id,{pluginData:[...root.pluginData.filter(entry=>!(entry.pluginId==="orion-xdesign"&&entry.key==="publishedLibraryAssets")),{pluginId:"orion-xdesign",key:"publishedLibraryAssets",value:JSON.stringify({libraryId:draft.libraryId,assetKeys:draft.rootIds.map(id=>graph.getNode(id)!.componentKey)})}]});
    };
    const candidate = deserializeGraph(draft.originalGraph); applyMetadata(candidate, draft.revisionId); serializeGraph(candidate);
    const revision = await this.catalog.publishRevision({ libraryId: draft.libraryId, name: draft.name, description: draft.description, graph: draft.sourceGraph, assetNodeIds: draft.rootIds, previousRevisionId: draft.previousRevisionId }, this.projectId);
    this.guard();
    editPencilGraph(this.editor, "Publish component library", () => applyMetadata(this.editor.graph, revision.manifest.revisionId));
    return revision;
  }
  async reviewUpdate(libraryId: string, targetRevisionId?: string): Promise<LibraryUpdateReview | null> {
    this.guard(); const binding = this.editor.graph.enabledLibraries.get(libraryId);
    if (!binding?.enabled) throw new Error("Enable this library before reviewing updates");
    const originalGraph = serializeGraph(this.editor.graph);
    const currentRevisionId = binding.revisionId;
    const contextGuard = this.reviewContextGuard();
    const assertUnchanged = () => {
      this.guard(); contextGuard?.();
      const currentBinding = this.editor.graph.enabledLibraries.get(libraryId);
      if (serializeGraph(this.editor.graph) !== originalGraph || !currentBinding?.enabled || currentBinding.revisionId !== currentRevisionId) throw new Error("The design changed. Review the library update again.");
    };
    contextGuard?.();
    const target = await this.catalog.getRevision(libraryId, targetRevisionId);
    assertUnchanged();
    if (target.manifest.libraryId !== libraryId || (targetRevisionId !== undefined && target.manifest.revisionId !== targetRevisionId)) throw new Error("The requested library revision could not be verified");
    const previous = target.manifest.revisionId === currentRevisionId ? target : await this.catalog.getRevision(libraryId, currentRevisionId);
    assertUnchanged();
    if (previous.manifest.libraryId !== libraryId || previous.manifest.revisionId !== currentRevisionId) throw new Error("The current library revision could not be verified");
    if (target.manifest.revisionId === currentRevisionId) return null;
    const graph = deserializeGraph(originalGraph);
    const usedKeys = new Set(linkedInstances(graph, libraryId).map(n => libraryIdentity(graph, n.componentId!)!.assetKey));
    installLibraryResources(graph, target);
    for (const asset of target.manifest.assets) if (usedKeys.has(asset.key)) materializePublicationAsset(graph, target, asset.key);
    const { plans, removed } = updatePlans(graph, target);
    let discardedOverrideCount = 0;
    for (const plan of plans) { discardedOverrideCount += swapLibraryInstance(graph, plan.instanceId, plan.componentId); reapplyInstanceComponentProperties({ graph }, plan.instanceId); }
    graph.enabledLibraries.set(libraryId, { libraryId, revisionId: target.manifest.revisionId, enabled: true });
    if (graph.nodes.size > 10_000) throw new Error("Library update exceeds the 10,000-layer transaction limit");
    assertUnchanged();
    const review: LibraryUpdateReview = { libraryId, name: target.manifest.name, currentRevisionId, targetRevisionId: target.manifest.revisionId, originalGraph, updatedGraph: serializeGraph(graph), changes: diffLibraryManifests(previous.manifest, target.manifest), ...libraryUpdateImpact(plans), removedInstanceCount: removed, discardedOverrideCount };
    issuedReviews.set(review, { owner: this, contextGuard, fingerprint: JSON.stringify(review) });
    return review;
  }
  applyUpdate(review: LibraryUpdateReview) {
    this.guard();
    const issued = issuedReviews.get(review);
    if (!issued || issued.owner !== this || JSON.stringify(review) !== issued.fingerprint) throw new Error("This library update review is invalid or belongs to another design session");
    issued.contextGuard?.(); this.guard();
    const binding = this.editor.graph.enabledLibraries.get(review.libraryId);
    if (serializeGraph(this.editor.graph) !== review.originalGraph || !binding?.enabled || binding.revisionId !== review.currentRevisionId) throw new Error("The design changed. Review the library update again.");
    const graph = deserializeGraph(review.updatedGraph);
    editPencilGraph(this.editor, `Update ${review.name}`, () => applyPencilGraphSnapshot(this.editor, graph));
    issuedReviews.delete(review);
  }
}

const sessions = new WeakMap<Editor, PencilLibrarySession>();
export function bindPencilLibraries(editor: Editor, projectId: string, guard: () => void) {
  const session = new PencilLibrarySession(editor, projectId, roomAwareLibraryCatalog(editor), guard); sessions.set(editor, session);
  return () => { session.dispose(); sessions.delete(editor); };
}
export function pencilLibraries(editor: Editor) {
  const session = sessions.get(editor); if (!session) throw new Error("Wait for component libraries to load"); return session;
}
