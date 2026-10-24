import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SceneGraph, type Fill } from "@open-pencil/scene-graph";
import { createLibraryRevision, readSourceLibraryPublication, validateLibraryRevision } from "@open-pencil/core/library";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { serializeGraph, deserializeGraph } from "./document";
import { startPencilSession, executeDesignToolAsync, usePencilWorkspace, runPencilLibraryAction } from "./runtime";
import { pencilLibraries, publicationSelection } from "./librarySession";
import { OrionLibraryCatalog } from "./libraryCatalog";
import { bindComponentProperty, createComponentProperty, resetInstanceProperties, setPreferredComponents } from "./componentProperties";
import { prepareLibrarySource } from "./libraryResources";
import { materializePublicationAsset } from "./libraryDependencies";
import { createSlot, editSlot, instanceSlotFrames, slotDefinitions, updateSlot } from "./slots";

const saved = vi.hoisted(() => ({ value: null as unknown, fail: false, writes: 0 }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@/lib/db", () => ({
  getAppState: vi.fn(async () => structuredClone(saved.value)),
  compareAndSetXDesignLibraries: vi.fn(async (next: unknown, expected: unknown) => {
    if (saved.fail) throw new Error("Injected library save failure");
    if (JSON.stringify(saved.value) !== JSON.stringify(expected)) throw new Error("Catalog changed in another window");
    saved.value = structuredClone(next); saved.writes++;
  }),
}));

let active: ReturnType<typeof startPencilSession> | null = null;
const solid = (r: number): Fill => ({ type: "SOLID", color: { r, g: 0, b: 0, a: 1 }, opacity: 1, visible: true });
function activate(graph = new SceneGraph(), id = ulid()) {
  active?.dispose(); useXDesign.getState().hydrate(null);
  useXDProjects.setState({ activeId: id, transitioning: false, ready: true, registry: [{ id, name: "Library test", createdAt: 0, updatedAt: 0 }] });
  const doc = { formatVersion: 1 as const, graph: serializeGraph(graph), pageId: graph.getPages()[0]!.id, panX: 0, panY: 0, zoom: 1, photoLinks: {} };
  useXDesign.setState({ pencilDocument: doc }); active = startPencilSession(document.createElement("div"), doc, () => undefined);
  return active.editor;
}
function componentGraph(withTokens = false) {
  const graph = new SceneGraph(), page = graph.getPages()[0]!;
  const component = graph.createNode("COMPONENT", page.id, { name: "Button", width: 140, height: 40, fills: [solid(.2)] });
  const text = graph.createNode("TEXT", component.id, { name: "Label", text: "Submit", width: 100, height: 24 });
  if (withTokens) {
    const collection = graph.createCollection("Brand"), darkMode = ulid(); graph.addMode(collection.id, darkMode, "Dark");
    const base = graph.createVariable("Red", "COLOR", collection.id, { r: .2, g: 0, b: 0, a: 1 });
    const alias = graph.createVariable("Button", "COLOR", collection.id, { aliasId: base.id });
    base.valuesByMode[darkMode] = { r: .8, g: 0, b: 0, a: 1 }; alias.valuesByMode[darkMode] = { aliasId: base.id };
    graph.bindVariable(component.id, "fills/0/color", alias.id); graph.updateNode(page.id, { variableModes: { [collection.id]: darkMode } });
  }
  return { graph, componentId: component.id, textId: text.id };
}
async function publish(name = "Controls", saveAsNew = false, loadPhoto?: (id: string) => Promise<Uint8Array>) {
  const draft = await runPencilLibraryAction(session => session.preparePublication(name, "Reusable controls", saveAsNew, loadPhoto));
  return runPencilLibraryAction(session => session.publish(draft));
}
async function insert(libraryId: string, assetKey = "button", values?: Record<string, string>) {
  return await executeDesignToolAsync("insert_library_component", { library_id: libraryId, asset_key: assetKey, x: 52, y: 74, ...(values ? { variant_values: JSON.stringify(values) } : {}) }) as { id: string; componentId: string };
}
beforeEach(() => { saved.value = null; saved.fail = false; saved.writes = 0; usePencilWorkspace.setState({ busy: false }); });
afterEach(() => { active?.dispose(); active = null; });

describe("Orion component libraries", () => {
  it("publishes slot preferences as dependencies and preserves instance contents through a library revision",async()=>{
    const {graph,componentId}=componentGraph();const icon=graph.createNode('COMPONENT',graph.getPages()[0]!.id,{name:'Icon'}),body=graph.createNode('FRAME',componentId,{name:'Body'});graph.createNode('TEXT',body.id,{text:'Default content'});
    const source=activate(graph),main=source.graph.getNode(componentId)!,frame=source.graph.getNode(body.id)!,property=createSlot(source,frame);
    updateSlot(source,main,property,{preferredValues:[icon.id],slotSettings:{maxChildren:3}});await publish('Slot controls');const sourceProject=useXDProjects.getState().activeId!;
    const library=readSourceLibraryPublication(source.graph)!.libraryId;source.select([componentId]);
    const consumer=activate(),placed=await insert(library),instance=consumer.graph.getNode(placed.id)!,slot=instanceSlotFrames(consumer.graph,instance)[0]!;
    expect(slotDefinitions(consumer.graph,instance)[0]?.preferredValues?.every(id=>consumer.graph.getNode(id)?.type==='COMPONENT')).toBe(true);
    editSlot(consumer,slot,'clear');const personal=consumer.graph.createNode('TEXT',slot.id,{text:'Personal content'});
    const consumerDocument=serializeGraph(consumer.graph),consumerProject=useXDProjects.getState().activeId!;
    const reopenedSource=activate(deserializeGraph(serializeGraph(source.graph)),sourceProject);reopenedSource.graph.updateNode(reopenedSource.graph.getNode(body.id)!.childIds[0]!,{text:'New default'});await publish('Slot controls');
    const reopenedConsumer=activate(deserializeGraph(consumerDocument),consumerProject),session=pencilLibraries(reopenedConsumer);
    const review=await session.reviewUpdate(library);expect(review).toBeTruthy();session.applyUpdate(review!);
    const updated=reopenedConsumer.graph.getNode(placed.id)!,updatedSlot=instanceSlotFrames(reopenedConsumer.graph,updated)[0]!;
    expect(reopenedConsumer.graph.getNode(updatedSlot.childIds[0]!)?.text).toBe('Personal content');expect(reopenedConsumer.graph.getNode(personal.id)).toBeTruthy();
    reopenedConsumer.undoAction();expect(reopenedConsumer.graph.getNode(personal.id)?.text).toBe('Personal content');
  });
  it("remaps legacy raw swap IDs from preserved source metadata and keeps missing legacy choices unavailable",async()=>{
    const {graph,componentId}=componentGraph();const icon=graph.createNode("COMPONENT",graph.getPages()[0]!.id,{name:"Icon",width:16,height:16});
    const source=activate(graph),main=source.graph.getNode(componentId)!,slot=source.graph.createInstance(icon.id,componentId)!;
    const property=createComponentProperty(source,main,"Icon","INSTANCE_SWAP",icon.id);bindComponentProperty(source,slot,"INSTANCE_SWAP",property);
    const prepared=await prepareLibrarySource(source.graph,"legacy-library",[componentId]);
    // The older upstream snapshot remapped instance IDs but kept property values.
    const revision=await createLibraryRevision({libraryId:"legacy-library",name:"Old controls",graph:prepared.graph,assetNodeIds:[componentId]});await validateLibraryRevision(revision);
    const root=revision.graph.getNode(revision.manifest.assets[0]!.sourceNodeId)!;
    root.componentPropertyDefinitions.find(def=>def.id===property)!.preferredValues=["missing-old-choice"];
    const consumer=new SceneGraph(),materialized=materializePublicationAsset(consumer,revision,"button"),definition=consumer.getNode(materialized.componentId)!.componentPropertyDefinitions.find(def=>def.id===property)!;
    expect(consumer.getNode(definition.defaultValue)?.name).toBe("Icon");expect(definition.preferredValues).toEqual(["missing-old-choice"]);
  });
  it("keeps equal-key swap choices from different libraries distinct without modifying read-only source definitions",async()=>{
    const icons=()=>{const graph=new SceneGraph();const icon=graph.createNode("COMPONENT",graph.getPages()[0]!.id,{name:"Icon",width:16,height:16});return {graph,icon};};
    const first=icons();first.graph.createNode("RECTANGLE",first.icon.id,{name:"Square",width:16,height:16});activate(first.graph);const firstLibrary=await publish("First icons");
    const second=icons();second.graph.createNode("ELLIPSE",second.icon.id,{name:"Circle",width:16,height:16});activate(second.graph);const secondLibrary=await publish("Second icons");
    const source=activate(),firstImported=await insert(firstLibrary.manifest.libraryId,"icon"),secondImported=await insert(secondLibrary.manifest.libraryId,"icon");
    const button=source.graph.createNode("COMPONENT",source.state.currentPageId,{name:"Button",width:160,height:40}),slot=source.graph.createInstance(firstImported.componentId,button.id)!;
    const property=createComponentProperty(source,button,"Icon","INSTANCE_SWAP",firstImported.componentId);bindComponentProperty(source,slot,"INSTANCE_SWAP",property);setPreferredComponents(source,button,property,[firstImported.componentId,secondImported.componentId]);
    const originals=[firstImported.componentId,secondImported.componentId].map(id=>structuredClone(source.graph.getNode(id)!));
    const draft=await runPencilLibraryAction(session=>session.preparePublication("Buttons","",false,undefined,[button.id]));const revision=await runPencilLibraryAction(session=>session.publish(draft));
    originals.forEach(node=>expect(source.graph.getNode(node.id)).toEqual(node));
    const consumer=activate(),inserted=await insert(revision.manifest.libraryId),instance=consumer.graph.getNode(inserted.id)!;
    const definition=consumer.getInstanceComponentPropertyDefinitions(instance.id).find(def=>def.id===property)!;
    expect(new Set(definition.preferredValues).size).toBe(2);
    expect(definition.preferredValues!.map(id=>consumer.graph.getChildren(id)[0]?.type).sort()).toEqual(["ELLIPSE","RECTANGLE"]);
  });
  it("publishes portable swap defaults and unused preferred dependencies, inserts, resets and detects dependency edits", async () => {
    const graph=new SceneGraph(),page=graph.getPages()[0]!;
    const button=graph.createNode("COMPONENT",page.id,{name:"Button",width:140,height:40});
    const first=graph.createNode("COMPONENT",page.id,{name:"First icon",width:16,height:16});graph.createNode("RECTANGLE",first.id,{name:"Square",width:16,height:16});
    const second=graph.createNode("COMPONENT",page.id,{name:"Second icon",width:16,height:16});const dot=graph.createNode("ELLIPSE",second.id,{name:"Dot",width:16,height:16});
    const sourceId=ulid(),source=activate(graph,sourceId),slot=source.graph.createInstance(first.id,button.id)!;
    const property=createComponentProperty(source,source.graph.getNode(button.id)!,"Icon","INSTANCE_SWAP",first.id);
    bindComponentProperty(source,slot,"INSTANCE_SWAP",property);setPreferredComponents(source,source.graph.getNode(button.id)!,property,[first.id,second.id]);
    const draft=await runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,[button.id]));
    const revision=await runPencilLibraryAction(session=>session.publish(draft));const sourceSaved=serializeGraph(source.graph);
    expect(revision.manifest.assets.map(asset=>asset.name)).toEqual(["Button"]);
    const consumer=activate(),inserted=await insert(revision.manifest.libraryId);const instance=consumer.graph.getNode(inserted.id)!;
    const definition=consumer.getInstanceComponentPropertyDefinitions(instance.id).find(def=>def.id===property)!;
    expect(definition.preferredValues).toHaveLength(2);
    expect(consumer.graph.getNode(definition.defaultValue)?.name).toBe("First icon");
    const secondId=definition.preferredValues!.find(id=>consumer.graph.getNode(id)?.name==="Second icon")!;
    expect(secondId).toBeTruthy();consumer.setInstanceComponentProperty(instance.id,property,secondId);
    expect(consumer.graph.getNode(instance.childIds[0]!)?.componentId).toBe(secondId);
    resetInstanceProperties(consumer,instance);expect(consumer.graph.getNode(instance.childIds[0]!)?.componentId).toBe(definition.defaultValue);
    const reopened=deserializeGraph(serializeGraph(consumer.graph));expect(reopened.getNode(secondId)?.name).toBe("Second icon");
    const changed=activate(deserializeGraph(sourceSaved),sourceId);changed.graph.updateNode(dot.id,{width:24});
    const nextDraft=await runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,[button.id]));
    expect(nextDraft.changes.some(change=>change.kind==="modified"&&change.asset.name==="Button")).toBe(true);
  });
  it("publishes selected assets with nested variant dependencies while excluding unrelated definitions and resources", async () => {
    const graph=new SceneGraph(),page=graph.getPages()[0]!;
    const set=graph.createNode("COMPONENT_SET",page.id,{name:"Icons"});
    const icon=graph.createNode("COMPONENT",set.id,{name:"Check",componentPropertyValues:{Kind:"Check"},width:16,height:16});
    graph.createNode("COMPONENT",set.id,{name:"Close",componentPropertyValues:{Kind:"Close"},width:16,height:16});
    const card=graph.createNode("COMPONENT",page.id,{name:"Card",width:160,height:80});
    const unrelated=graph.createNode("COMPONENT",page.id,{name:"Private draft",width:20,height:20});
    const collection=graph.createCollection("Private"),variable=graph.createVariable("Unused","FLOAT",collection.id,99);
    graph.bindVariable(unrelated.id,"opacity",variable.id);
    const editor=activate(graph);editor.createInstanceFromComponent(icon.id,0,0,card.id);
    const draft=await runPencilLibraryAction(session=>session.preparePublication("Cards","",false,undefined,[card.id]));
    expect(draft.rootIds).toEqual([card.id]);expect(draft.changes.map(change=>change.asset.name)).toEqual(["Card"]);
    const revision=await runPencilLibraryAction(session=>session.publish(draft));
    expect(revision.manifest.assets.map(asset=>asset.name)).toEqual(["Card"]);
    expect([...revision.graph.nodes.values()].some(node=>node.name==="Private draft")).toBe(false);
    expect(revision.graph.variables.size).toBe(0);
    const consumer=activate();const result=await insert(revision.manifest.libraryId,"card");
    const nested=consumer.graph.getChildren(result.id)[0]!;
    expect(consumer.graph.getNode(nested.componentId!)?.name).toBe("Check");
    expect(consumer.graph.getChildren(consumer.graph.getNode(nested.componentId!)!.parentId!).map(node=>node.name)).toEqual(["Check","Close"]);
  });
  it("reviews unpublishing independently of source deletion and retains saved instances", async () => {
    const {graph,componentId}=componentGraph();const omitted=graph.createNode("COMPONENT",graph.getPages()[0]!.id,{name:"Omitted",width:24,height:24});
    const sourceId=ulid(),source=activate(graph,sourceId);const first=await publish();const sourceGraph=serializeGraph(source.graph);
    const consumerId=ulid(),consumer=activate(new SceneGraph(),consumerId);const instance=await insert(first.manifest.libraryId,"omitted");const consumerGraph=serializeGraph(consumer.graph);
    const updated=activate(deserializeGraph(sourceGraph),sourceId);
    const draft=await runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,[componentId]));
    expect(draft.changes.filter(change=>change.kind==="removed").map(change=>change.asset.name)).toEqual(["Omitted"]);
    await runPencilLibraryAction(session=>session.publish(draft));expect(updated.graph.getNode(omitted.id)).toBeTruthy();
    expect([...publicationSelection(deserializeGraph(serializeGraph(updated.graph)))]).toEqual([componentId]);
    updated.undoAction();expect(publicationSelection(updated.graph).has(omitted.id)).toBe(true);
    const freshReview=await runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,[componentId]));
    expect(freshReview.previousRevisionId).not.toBe(first.manifest.revisionId);expect(freshReview.changes).toHaveLength(0);updated.redoAction();
    activate(deserializeGraph(consumerGraph),consumerId);const review=await runPencilLibraryAction(session=>session.reviewUpdate(first.manifest.libraryId));
    expect(review?.removedInstanceCount).toBe(1);await runPencilLibraryAction(async session=>session.applyUpdate(review!));
    expect(active!.editor.graph.getNode(instance.id)?.componentId).toBe(instance.componentId);
  });
  it("rejects stale, duplicate, non-root and empty new publication choices before writing", async () => {
    const {graph,componentId,textId}=componentGraph();activate(graph);
    for(const ids of [["gone"],[componentId,componentId],[textId],[]]) {
      await expect(runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,ids))).rejects.toThrow();
    }
    expect(saved.writes).toBe(0);
    await publish();const draft=await runPencilLibraryAction(session=>session.preparePublication("Controls","",false,undefined,[]));
    expect(draft.changes.every(change=>change.kind==="removed")).toBe(true);
    const empty=await runPencilLibraryAction(session=>session.publish(draft));expect(empty.manifest.assets).toHaveLength(0);
  });
  it("reviews without writes and preserves the source graph when publication fails", async () => {
    const { graph } = componentGraph(); const editor = activate(graph); const before = serializeGraph(editor.graph);
    const draft = await runPencilLibraryAction(session => session.preparePublication("Controls", ""));
    expect(saved.writes).toBe(0); expect(serializeGraph(editor.graph)).toBe(before); expect(draft.changes[0]?.kind).toBe("added");
    saved.fail = true; await expect(runPencilLibraryAction(session => session.publish(draft))).rejects.toThrow("save failure");
    expect(saved.value).toBeNull(); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.undo.canUndo).toBe(false);
  });
  it("persists immutable revisions with aliases and inherited modes across catalog reload", async () => {
    const { graph, componentId } = componentGraph(true); const editor = activate(graph); const revision = await publish();
    expect(editor.graph.getNode(componentId)?.componentKey).toBe("button"); expect(readSourceLibraryPublication(editor.graph)?.revisionId).toBe(revision.manifest.revisionId);
    const reopened = await new OrionLibraryCatalog().getRevision(revision.manifest.libraryId);
    expect(reopened.graph.variables.size).toBe(2); const root = reopened.graph.getNode(reopened.manifest.assets[0]!.sourceNodeId)!;
    const variableId = root.boundVariables["fills/0/color"]!;
    expect(reopened.graph.resolveColorVariableForNode(root.id, variableId)?.r).toBe(.8);
    reopened.graph.updateNode(root.id, { width: 999 });
    expect((await new OrionLibraryCatalog().getRevision(revision.manifest.libraryId)).graph.getNode(root.id)?.width).toBe(140);
  });
  it("lists and inserts through the real Orion tool adapter with one complete undo step", async () => {
    activate(componentGraph(true).graph); const revision = await publish(); const editor = activate(); const before = serializeGraph(editor.graph);
    const listed = await executeDesignToolAsync("list_libraries", {}) as { count: number; libraries: { libraryId: string }[] };
    expect(listed.count).toBe(1); expect(listed.libraries[0]?.libraryId).toBe(revision.manifest.libraryId);
    const result = await insert(revision.manifest.libraryId); const instance = editor.graph.getNode(result.id)!;
    expect(instance.type).toBe("INSTANCE"); expect(instance.x).toBe(52); expect(instance.y).toBe(74);
    expect(editor.graph.resolveColorVariableForNode(instance.id, instance.boundVariables["fills/0/color"]!)?.r).toBe(.8);
    expect(editor.graph.getPages()).toHaveLength(1); expect(editor.graph.getPages(true)).toHaveLength(2);
    editor.undoAction(); expect(serializeGraph(editor.graph)).toBe(before);
    editor.redoAction(); expect(editor.graph.getNode(result.id)?.componentId).toBe(result.componentId); expect(editor.graph.getInstances(result.componentId)).toHaveLength(1);
    const reopened = deserializeGraph(serializeGraph(editor.graph)); expect(reopened.enabledLibraries.get(revision.manifest.libraryId)?.revisionId).toBe(revision.manifest.revisionId);
  });
  it("rolls back definitions, tokens and library bindings when insertion is invalid", async () => {
    activate(componentGraph(true).graph); const revision = await publish(); const editor = activate(); const before = serializeGraph(editor.graph);
    await expect(insert(revision.manifest.libraryId, "missing")).rejects.toThrow("not found"); expect(serializeGraph(editor.graph)).toBe(before);
    await expect(insert(revision.manifest.libraryId, "button", { Size: "Missing" })).rejects.toThrow("no variants"); expect(serializeGraph(editor.graph)).toBe(before);
    expect(editor.undo.canUndo).toBe(false); expect(usePencilWorkspace.getState().busy).toBe(false);
  });
  it("keeps old instances pinned and preserves text overrides when a reviewed update is applied and undone", async () => {
    const { graph, componentId, textId } = componentGraph(); const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish();
    const sourceSaved = serializeGraph(source.graph); const consumerProject = ulid(); const editor = activate(new SceneGraph(), consumerProject); const result = await insert(first.manifest.libraryId);
    const label = editor.graph.getChildren(result.id)[0]!; editor.updateNodeWithUndo(label.id, { text: "Buy now" });
    const consumerSaved = serializeGraph(editor.graph);
    const changed = deserializeGraph(sourceSaved); changed.updateNode(componentId, { width: 220, fills: [solid(.7)] }); changed.updateNode(textId, { text: "Continue" });
    activate(changed, sourceProject); const latest = await publish();
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); expect(consumer.graph.getNode(result.id)?.width).toBe(140);
    const before = serializeGraph(consumer.graph); const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId));
    expect(review?.affectedInstanceCount).toBe(1); expect(review?.discardedOverrideCount).toBe(0); expect(serializeGraph(consumer.graph)).toBe(before);
    await runPencilLibraryAction(async session => session.applyUpdate(review!));
    expect(consumer.graph.getNode(result.id)?.width).toBe(220); expect(consumer.graph.getChildren(result.id)[0]?.text).toBe("Buy now");
    expect(consumer.graph.getNode(result.id)?.x).toBe(52); expect(consumer.graph.enabledLibraries.get(first.manifest.libraryId)?.revisionId).toBe(latest.manifest.revisionId);
    consumer.undoAction(); expect(serializeGraph(consumer.graph)).toBe(before); expect(consumer.graph.getNode(label.id)?.text).toBe("Buy now");
    consumer.redoAction(); expect(consumer.graph.getChildren(result.id)[0]?.text).toBe("Buy now");
  });
  it("makes variable-only changes produce a new revision without overwriting old token values", async () => {
    const { graph } = componentGraph(true); const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish(); const sourceSaved = serializeGraph(source.graph);
    const editor = activate(); const result = await insert(first.manifest.libraryId); const consumerProject = useXDProjects.getState().activeId!; const consumerSaved = serializeGraph(editor.graph);
    const changed = deserializeGraph(sourceSaved); const base = [...changed.variables.values()].find(v => v.name === "Red")!;
    for (const mode of Object.keys(base.valuesByMode)) base.valuesByMode[mode] = { r: .4, g: 0, b: 0, a: 1 };
    activate(changed, sourceProject); const latest = await publish(); expect(latest.manifest.assets[0]?.contentHash).not.toBe(first.manifest.assets[0]?.contentHash);
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); const original = consumer.graph.getNode(result.id)!; const originalVar = original.boundVariables["fills/0/color"]!;
    expect(consumer.graph.resolveColorVariableForNode(result.id, originalVar)?.r).toBe(.8);
    const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId)); await runPencilLibraryAction(async session => session.applyUpdate(review!));
    expect(consumer.graph.resolveColorVariableForNode(result.id, consumer.graph.getNode(result.id)!.boundVariables["fills/0/color"]!)?.r).toBe(.4);
    expect(consumer.graph.resolveColorVariable(originalVar)?.r).toBe(.2); // Its collection's default mode remains unchanged.
    consumer.undoAction(); expect(consumer.graph.resolveColorVariableForNode(result.id, originalVar)?.r).toBe(.8);
  });
  it("matches component-set variants and explicitly counts fallback when a combination is removed", async () => {
    const graph = new SceneGraph(), set = graph.createNode("COMPONENT_SET", graph.getPages()[0]!.id, { name: "Toggle" });
    graph.createNode("COMPONENT", set.id, { name: "Off", componentPropertyValues: { State: "Off" }, width: 80, height: 30 });
    const on = graph.createNode("COMPONENT", set.id, { name: "On", componentPropertyValues: { State: "On" }, x: 100, width: 90, height: 30 });
    const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish(); const sourceSaved = serializeGraph(source.graph);
    const consumerProject = ulid(); const editor = activate(new SceneGraph(), consumerProject); const result = await insert(first.manifest.libraryId, "toggle", { State: "On" }); expect(editor.graph.getNode(result.id)?.width).toBe(90);
    const beforeFailed = serializeGraph(editor.graph); await expect(insert(first.manifest.libraryId, "toggle", { State: "Invalid" })).rejects.toThrow("does not exist"); expect(serializeGraph(editor.graph)).toBe(beforeFailed);
    const consumerSaved = serializeGraph(editor.graph); const changed = deserializeGraph(sourceSaved); changed.deleteNode(on.id); activate(changed, sourceProject); await publish();
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId));
    expect(review?.affectedInstanceCount).toBe(1); expect(review?.fallbackInstanceCount).toBe(1);
    await runPencilLibraryAction(async session => session.applyUpdate(review!)); expect(consumer.graph.getNode(result.id)?.width).toBe(80);
    consumer.undoAction(); expect(consumer.graph.getNode(result.id)?.width).toBe(90);
  });
  it("retains removed component definitions and flags overrides on removed layers", async () => {
    const { graph, textId } = componentGraph(); const another = graph.createNode("COMPONENT", graph.getPages()[0]!.id, { name: "Removed", width: 30, height: 20 });
    const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish(); const sourceSaved = serializeGraph(source.graph);
    const consumerProject = ulid(); const editor = activate(new SceneGraph(), consumerProject); const button = await insert(first.manifest.libraryId); const removed = await insert(first.manifest.libraryId, "removed");
    const label = editor.graph.getChildren(button.id)[0]!; editor.updateNodeWithUndo(label.id, { text: "My label" }); const consumerSaved = serializeGraph(editor.graph);
    const changed = deserializeGraph(sourceSaved); changed.deleteNode(another.id); changed.deleteNode(textId); activate(changed, sourceProject); await publish();
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId));
    expect(review?.removedInstanceCount).toBe(1); expect(review?.discardedOverrideCount).toBeGreaterThan(0);
    await runPencilLibraryAction(async session => session.applyUpdate(review!)); expect(consumer.graph.getNode(removed.id)?.componentId).toBe(removed.componentId); expect(consumer.graph.getNode(removed.componentId)).toBeTruthy();
  });
  it("rejects a stale publication review and a stale consumer update without mutating the canvas", async () => {
    const { graph, componentId } = componentGraph(); const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish(); const sourceSaved = serializeGraph(source.graph);
    const draft = await runPencilLibraryAction(session => session.preparePublication("Controls", "")); source.graph.updateNode(componentId, { width: 150 });
    await expect(runPencilLibraryAction(session => session.publish(draft))).rejects.toThrow("design changed"); expect(saved.writes).toBe(1);
    const consumerProject = ulid(); const editor = activate(new SceneGraph(), consumerProject); await insert(first.manifest.libraryId); const consumerSaved = serializeGraph(editor.graph);
    const changed = deserializeGraph(sourceSaved); changed.updateNode(componentId, { width: 170 }); activate(changed, sourceProject); await publish();
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId));
    consumer.graph.createNode("RECTANGLE", consumer.state.currentPageId); const before = serializeGraph(consumer.graph);
    await expect(runPencilLibraryAction(async session => session.applyUpdate(review!))).rejects.toThrow("design changed"); expect(serializeGraph(consumer.graph)).toBe(before);
  });
  it("disables new insertions while preserving existing instances and supports undo of library preferences", async () => {
    activate(componentGraph().graph); const first = await publish(); const editor = activate(); const result = await insert(first.manifest.libraryId);
    await runPencilLibraryAction(session => session.setEnabled(first.manifest.libraryId, false));
    await expect(insert(first.manifest.libraryId)).rejects.toThrow("Enable"); expect(editor.graph.getNode(result.id)).toBeTruthy();
    editor.undoAction(); expect(editor.graph.enabledLibraries.get(first.manifest.libraryId)?.enabled).toBe(true);
  });
  it("embeds full-resolution linked photos and removes source-project photo references", async () => {
    const { graph, componentId } = componentGraph(); graph.images.set("preview", new Uint8Array([1])); graph.updateNode(componentId, { fills: [{ ...solid(0), type: "IMAGE", imageHash: "preview" }], pluginData: [{ pluginId: "orion.xdesign", key: "photoDocumentId", value: "photo-1" }] });
    activate(graph); const bytes = new Uint8Array([137, 80, 78, 71, 20, 30]); const load = vi.fn(async () => bytes); const revision = await publish("Photo controls", false, load);
    expect(load).toHaveBeenCalledWith("photo-1"); const root = revision.graph.getNode(revision.manifest.assets[0]!.sourceNodeId)!;
    expect(root.pluginData.some(p => p.key === "photoDocumentId")).toBe(false); expect(revision.graph.images.get(root.fills[0]!.imageHash!)).toEqual(bytes);
    expect(revision.graph.images.has("preview")).toBe(false);
  });
  it("does not overwrite malformed or tampered library storage", async () => {
    const { graph } = componentGraph(); activate(graph); const first = await publish(); const valid = structuredClone(saved.value);
    saved.value = { formatVersion: 9, libraries: [] }; await expect(new OrionLibraryCatalog().listLibraries()).rejects.toThrow("not been overwritten");
    expect(saved.writes).toBe(1); saved.value = valid;
    const state = saved.value as { libraries: { revisions: { graph: string }[] }[] }; state.libraries[0]!.revisions[0]!.graph += " ";
    await expect(new OrionLibraryCatalog().getRevision(first.manifest.libraryId)).rejects.toThrow("integrity"); expect(saved.writes).toBe(1);
  });
  it("rejects publishing a copied project's source-library identity and allows a separate new library", async () => {
    activate(componentGraph().graph); await publish(); const copy = deserializeGraph(serializeGraph(active!.editor.graph)); activate(copy);
    const draft = await runPencilLibraryAction(session => session.preparePublication("Copied controls", ""));
    await expect(runPencilLibraryAction(session => session.publish(draft))).rejects.toThrow("original project"); expect(saved.writes).toBe(1);
    await publish("Copied controls", true); expect((await new OrionLibraryCatalog().listLibraries())).toHaveLength(2);
  });
  it("rejects a publication based on an older revision after another publisher advances the catalog", async () => {
    const { graph, componentId } = componentGraph(); activate(graph); const first = await publish();
    const session = pencilLibraries(active!.editor); const draft = await session.preparePublication("Controls", "");
    const changed = deserializeGraph(serializeGraph(active!.editor.graph)); changed.updateNode(componentId, { width: 190 });
    const { prepareLibrarySource } = await import("./libraryResources"); const source = await prepareLibrarySource(changed, first.manifest.libraryId, [componentId]);
    await new OrionLibraryCatalog().publishRevision({ libraryId: first.manifest.libraryId, name: "Controls", graph: source.graph, previousRevisionId: first.manifest.revisionId, assetNodeIds: [componentId] }, useXDProjects.getState().activeId!);
    await expect(session.publish(draft)).rejects.toThrow("newer revision"); expect(saved.writes).toBe(2);
  });
  it("publishes nested instances of component-set variants with portable dependency identities", async () => {
    const graph = new SceneGraph(), page = graph.getPages()[0]!;
    const set = graph.createNode("COMPONENT_SET", page.id, { name: "Icon" });
    const variant = graph.createNode("COMPONENT", set.id, { name: "Check", width: 20, height: 20, componentPropertyValues: { Kind: "Check" } });
    const card = graph.createNode("COMPONENT", page.id, { name: "Card", width: 200, height: 80 }); graph.createInstance(variant.id, card.id);
    activate(graph); const revision = await publish(); expect(revision.manifest.assets).toHaveLength(2);
    const editor = activate(); const result = await insert(revision.manifest.libraryId, "card"); const nested = editor.graph.getChildren(result.id)[0]!;
    expect(nested.type).toBe("INSTANCE"); expect(editor.graph.getNode(nested.componentId!)?.name).toBe("Check"); expect(editor.graph.getNode(nested.componentId!)?.componentPropertyValues).toEqual({ Kind: "Check" });
    const icon = await insert(revision.manifest.libraryId, "icon", { Kind: "Check" }); expect(editor.graph.getNode(icon.id)?.width).toBe(20);
  });
  it("keeps a personal linked-image override when its library root is updated", async () => {
    const { graph, componentId } = componentGraph(); const sourceProject = ulid(); const source = activate(graph, sourceProject); const first = await publish(); const sourceSaved = serializeGraph(source.graph);
    const consumerProject = ulid(); const editor = activate(new SceneGraph(), consumerProject); const result = await insert(first.manifest.libraryId);
    editor.graph.images.set("personal", new Uint8Array([1, 2, 3])); editor.graph.updateNode(result.id, { fills: [{ ...solid(0), type: "IMAGE", imageHash: "personal" }], pluginData: [{ pluginId: "orion.xdesign", key: "photoDocumentId", value: "personal-photo" }] });
    const consumerSaved = serializeGraph(editor.graph); const changed = deserializeGraph(sourceSaved); changed.updateNode(componentId, { width: 180, fills: [solid(.9)] }); activate(changed, sourceProject); await publish();
    const consumer = activate(deserializeGraph(consumerSaved), consumerProject); const review = await runPencilLibraryAction(session => session.reviewUpdate(first.manifest.libraryId)); await runPencilLibraryAction(async session => session.applyUpdate(review!));
    expect(consumer.graph.getNode(result.id)?.fills[0]?.imageHash).toBe("personal"); expect(consumer.graph.getNode(result.id)?.pluginData.find(p => p.key === "photoDocumentId")?.value).toBe("personal-photo"); expect(consumer.graph.getNode(result.id)?.width).toBe(180);
  });
  it("rejects an asynchronous library insert after the originating canvas closes", async () => {
    activate(componentGraph().graph); const revision = await publish(); const editor = activate(); const session = pencilLibraries(editor);
    let release: (value: unknown) => void = () => undefined; const read = vi.spyOn(session.catalog, "getRevision").mockImplementationOnce(() => new Promise(resolve => { release = resolve as (value: unknown) => void; }));
    const work = session.insertComponent({ libraryId: revision.manifest.libraryId, assetKey: "button" }); active!.dispose(); active = null; const before = serializeGraph(editor.graph);
    release(revision); await expect(work).rejects.toThrow("closed"); expect(serializeGraph(editor.graph)).toBe(before); read.mockRestore();
  });
  it("records and undoes property-panel instance overrides together with their values", async () => {
    activate(componentGraph().graph); const revision = await publish(); const editor = activate(); const result = await insert(revision.manifest.libraryId);
    editor.updateNodeWithUndo(result.id, { width: 180 }); expect(editor.graph.getNode(result.id)?.instanceOverrides.self.has("width")).toBe(true);
    editor.undoAction(); expect(editor.graph.getNode(result.id)?.width).toBe(140); expect(editor.graph.getNode(result.id)?.instanceOverrides.self.has("width")).toBe(false);
    editor.redoAction(); expect(editor.graph.getNode(result.id)?.width).toBe(180); expect(editor.graph.getNode(result.id)?.instanceOverrides.self.has("width")).toBe(true);
  });
  it("compacts legacy revision graphs without removing revisions and cancels on checksum failure",async()=>{
    activate(componentGraph().graph);const first=await publish();const catalog=new OrionLibraryCatalog();
    const storage=saved.value as {libraries:{revisions:{graph:string;checksum:string}[]}[]};const revision=storage.libraries[0]!.revisions[0]!;
    const graph=deserializeGraph(revision.graph,true);const raw=JSON.parse(revision.graph);raw.nodes={$xdesign:"Map",values:[...graph.nodes]};
    revision.graph=JSON.stringify(raw,(_key,value)=>value instanceof Map?{$xdesign:"Map",values:[...value]}:value,2);
    const {contentHash}=await import("@open-pencil/core/library");revision.checksum=await contentHash({graph:revision.graph});
    const result=await catalog.compactRevisions();expect(result.revisions).toBe(1);expect(result.afterBytes).toBeLessThan(result.beforeBytes);expect((await catalog.getRevision(first.manifest.libraryId)).manifest.revisionId).toBe(first.manifest.revisionId);
    const before=JSON.stringify(saved.value);(saved.value as typeof storage).libraries[0]!.revisions[0]!.checksum="bad";const corrupted=JSON.stringify(saved.value);await expect(catalog.compactRevisions()).rejects.toThrow("integrity");expect(JSON.stringify(saved.value)).toBe(corrupted);expect(before).not.toBe(corrupted);
  });

});
