import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { allDesignActions, type DesignNavigation, type DesignNode } from './reactExportRuntime';
import { readPrototype, setNavigation, setPrototypeInteractions } from './prototype';
import { navigatePrototype, routePrototype } from './prototypeRouteRuntime';
import { resolveNativeReactScreens } from './nativeReactScreens';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { installPrototypeEditing } from './prototypeEditing';
import { deserializeGraph, serializeGraph } from './document';
import { placePreparedVideo } from './videoPaints';
import { withClipboardVideoResources } from './videoClipboard';
import { setComponentBehaviour } from './behaviour/editor';
import { claimSlotContent, createSlot, installSlotSupport, instanceSlotFrames } from './slots';

let source: Editor, target: Editor;
const operations = ['play', 'pause', 'toggle'] as const;
type Operation = typeof operations[number];
const media = (target: string, mediaAction: Operation): DesignNavigation => ({ action: 'media', mediaAction, target, transition: 'instant', duration: 0 });
beforeEach(() => { source = createEditor(); target = createEditor(); installPrototypeEditing(source); installPrototypeEditing(target); });
afterEach(() => { source.dispose(); target.dispose(); });

function fixture(operation: Operation = 'play') {
  const graph = source.graph, page = source.state.currentPageId;
  const screen = graph.createNode('FRAME', page, { name: 'Media export screen', width: 320, height: 240, fills: [] });
  const button = graph.createNode('RECTANGLE', screen.id, { name: 'Targeted playback button', width: 100, height: 24, fills: [] });
  const videoId = placePreparedVideo(source, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Targeted clip', width: 80, height: 45, duration: 3 }, 0, 50);
  graph.reparentNode(videoId, screen.id);
  const siblingId = placePreparedVideo(source, { bytes: new Uint8Array([4, 5, 6]), poster: new Uint8Array([137, 80, 78, 72]), mime: 'video/webm', name: 'Targeted clip', width: 80, height: 45, duration: 3 }, 100, 50);
  graph.reparentNode(siblingId, screen.id);
  const action = media(videoId, operation); setNavigation(source, button, action);
  return { graph, screen, button, video: graph.getNode(videoId)!, sibling: graph.getNode(siblingId)!, action };
}
function flatten(nodes: DesignNode[]): DesignNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children), ...(node.control?.variants.flatMap(variant => flatten([variant.tree])) ?? [])]);
}
function playback(editor: Editor, node: SceneNode) {
  return (readPrototype(editor.graph.getNode(node.id) ?? node).interactions ?? []).flatMap(interaction => allDesignActions(interaction.navigation)).filter(action => action.action === 'media');
}
function child(editor: Editor, parent: SceneNode, name: string) {
  const found = editor.graph.getChildren(parent.id).find(node => node.name === name); expect(found).toBeDefined(); return found!;
}

it.each(operations)('reconnects %s to its exact exported video identity without adding a screen dependency', operation => {
  const f = fixture(operation), before = serializeGraph(f.graph), data = f.button.pluginData;
  const model = selectionToDesignModel(f.graph, [f.screen.id]); expect(model.prototypeIssues).toEqual([]);
  const nodes = flatten(model.nodes), button = nodes.find(node => node.name === f.button.name)!;
  expect(f.screen.childIds).toEqual([f.button.id, f.video.id, f.sibling.id]);
  const video = nodes.find(node => node.id === `${f.screen.id}/1`)!;
  const sibling = nodes.find(node => node.id === `${f.screen.id}/2`)!;
  expect(video.video).toBeDefined(); expect(sibling.video).toBeDefined(); expect(video.id).not.toBe(f.video.id); expect(video.id).not.toBe(sibling.id);
  expect(button.navigation).toEqual({ ...f.action, target: video.id }); expect(button.navigation?.target).not.toBe(sibling.id);
  expect(resolveNativeReactScreens(f.graph, f.screen.id)).toEqual([f.screen.id]);
  const delivered = selectionToReact(f.graph, [f.screen.id]); expect(delivered.code).toContain('mediaAction'); expect(delivered.code).toContain(video.id);
  expect(serializeGraph(f.graph)).toBe(before); expect(f.button.pluginData).toBe(data);
});

it('reconnects nested conditional media targets and includes only actual navigation screens', () => {
  const f = fixture('pause'), destination = f.graph.createNode('FRAME', source.state.currentPageId, { name: 'Actual media route', width: 80, height: 60, fills: [] });
  const action: DesignNavigation = { action: 'sequence', transition: 'instant', duration: 0, actions: [media(f.video.id, 'play'), { action: 'conditional', transition: 'instant', duration: 0, branches: [{ condition: { type: 'literal', value: true }, actions: [media(f.sibling.id, 'pause'), { action: 'navigate', target: destination.id, transition: 'instant', duration: 0 }] }, { actions: [media(f.video.id, 'toggle')] }] }] };
  setPrototypeInteractions(source, f.button, [{ id: 'media-sequence', trigger: { type: 'click' }, navigation: action }]);
  const before = serializeGraph(f.graph), model = selectionToDesignModel(f.graph, [f.screen.id]); expect(model.prototypeIssues).toEqual([]);
  const nodes = flatten(model.nodes), button = nodes.find(node => node.id === `${f.screen.id}/0`)!;
  const actions = allDesignActions(button.interactions![0]!.navigation), first = nodes.find(node => node.id === `${f.screen.id}/1`)!, second = nodes.find(node => node.id === `${f.screen.id}/2`)!;
  expect(actions.map(action => action.action)).toEqual(['media', 'conditional', 'media', 'navigate', 'media']);
  expect(actions.filter(action => action.action === 'media').map(action => [action.mediaAction, action.target])).toEqual([['play', first.id], ['pause', second.id], ['toggle', first.id]]);
  expect(actions.find(action => action.action === 'navigate')?.target).toBe(destination.id);
  expect(resolveNativeReactScreens(f.graph, f.screen.id)).toEqual([f.screen.id, destination.id]); expect(serializeGraph(f.graph)).toBe(before);
});

it('separates stable target identities for repeated overlay model occurrences without editing the source', () => {
  const f = fixture('toggle'), before = serializeGraph(f.graph);
  const models = ['occurrence-one', 'occurrence-two'].map(scope => selectionToDesignModel(f.graph, [f.screen.id], undefined, true, undefined, undefined, false, scope));
  const bindings = models.map(model => {
    expect(model.prototypeIssues).toEqual([]); const nodes = flatten(model.nodes), button = nodes.find(node => node.sourceId === f.button.id)!, video = nodes.find(node => node.sourceId === f.video.id)!;
    expect(button.navigation).toEqual({ ...f.action, target: video.id }); return video.id;
  });
  expect(bindings[0]).not.toBe(bindings[1]); expect(bindings.every(id => id.includes('occurrence-'))).toBe(true); expect(serializeGraph(f.graph)).toBe(before);
});

it('diagnoses a missing portable video target while preserving source-qualified presentation metadata', () => {
  const f = fixture(), before = serializeGraph(f.graph);
  const portable = selectionToDesignModel(f.graph, [f.button.id]);
  expect(portable.prototypeIssues).toContain(`${f.button.name}: Include its video target in this export.`);
  expect(portable.nodes[0]!.navigation).toEqual({ ...f.action, unresolved: true });
  const presentation = selectionToDesignModel(f.graph, [f.button.id], undefined, true);
  expect(presentation.nodes[0]!.navigation).toEqual(f.action); expect(presentation.prototypeIssues).toEqual([]);
  expect(resolveNativeReactScreens(f.graph, f.screen.id)).toEqual([f.screen.id]); expect(serializeGraph(f.graph)).toBe(before);
});

it.each(operations)('remaps %s through native duplicate, snapshot, HTML paste and serialized reopening', async operation => {
  const f = fixture(operation); source.select([f.screen.id]); const original = serializeGraph(f.graph);
  source.duplicateSelected(); const copy = source.getSelectedNodes()[0]!, copyButton = child(source, copy, f.button.name), videos = source.graph.getChildren(copy.id).filter(node => node.fills.some(fill => fill.type === 'VIDEO'));
  expect(videos).toHaveLength(2); expect(playback(source, copyButton)).toEqual([media(videos[0]!.id, operation)]); expect(videos[0]!.id).not.toBe(f.video.id); expect(playback(source, f.button)).toEqual([f.action]);
  source.undoAction(); expect(serializeGraph(f.graph)).toBe(original); source.redoAction(); const redone = source.getSelectedNodes()[0]!; expect(playback(source, child(source, redone, f.button.name))[0]?.target).toBe(source.graph.getChildren(redone.id).filter(node => node.fills.some(fill => fill.type === 'VIDEO'))[0]!.id);
  source.undoAction(); source.select([f.screen.id]); const payload = await source.prepareCopy(); withClipboardVideoResources(f.graph, payload); const snapshot = structuredClone(payload.snapshot!), snapshotBefore = structuredClone(snapshot);
  await target.pasteSnapshot(snapshot); const pasted = target.getSelectedNodes()[0]!, pastedButton = child(target, pasted, f.button.name), pastedVideos = target.graph.getChildren(pasted.id).filter(node => node.fills.some(fill => fill.type === 'VIDEO'));
  expect(playback(target, pastedButton)).toEqual([media(pastedVideos[0]!.id, operation)]); expect(pastedVideos[0]!.id).not.toBe(f.video.id); expect(snapshot).toEqual(snapshotBefore);
  target.undoAction(); expect(target.graph.getNode(pasted.id)).toBeUndefined(); target.redoAction(); expect(playback(target, child(target, target.getSelectedNodes()[0]!, f.button.name))[0]?.target).toBe(pastedVideos[0]!.id); target.undoAction();
  await target.pasteFromHTML(payload.html); const html = target.getSelectedNodes()[0]!, htmlButton = child(target, html, f.button.name), htmlVideo = target.graph.getChildren(html.id).filter(node => node.fills.some(fill => fill.type === 'VIDEO'))[0]!;
  expect(playback(target, htmlButton)).toEqual([media(htmlVideo.id, operation)]);
  const reopened = deserializeGraph(serializeGraph(target.graph)); expect(readPrototype(reopened.getNode(htmlButton.id)!).link).toEqual(media(htmlVideo.id, operation));
  expect(serializeGraph(f.graph)).toBe(original);
});

it('marks a pasted media reference unresolved when its video was outside the copied subtree', async () => {
  const f = fixture(); source.select([f.button.id]); const before = serializeGraph(f.graph), payload = await source.prepareCopy(), snapshot = structuredClone(payload.snapshot!), snapshotBefore = structuredClone(snapshot);
  await target.pasteSnapshot(snapshot); const pasted = target.getSelectedNodes()[0]!, action = playback(target, pasted)[0]!;
  expect(action).toEqual({ ...f.action, unresolved: true }); expect(target.graph.getNode(f.video.id)).toBeUndefined();
  const model = selectionToDesignModel(target.graph, [pasted.id]); expect(model.nodes[0]!.navigation?.unresolved).toBe(true); expect(model.prototypeIssues.some(issue => issue.includes('video target'))).toBe(true);
  expect(snapshot).toEqual(snapshotBefore); expect(serializeGraph(f.graph)).toBe(before);
});

it.each(operations)('refuses %s in both pure route helpers even with a forged existing screen target', operation => {
  const f = fixture(operation), destination = f.graph.createNode('FRAME', source.state.currentPageId, { name: 'Not a media destination', width: 100, height: 100 });
  const history = ['previous'], overlays = [{ screen: destination.id, origin: { x: 2, y: 3 }, offset: { x: 4, y: 5 }, instanceId: 'retained-overlay' }], route = { screen: f.screen.id, history, overlays }, before = structuredClone(route);
  for (const action of [f.action, { ...f.action, target: destination.id }]) {
    expect(() => navigatePrototype(f.screen.id, history, action, new Set([f.screen.id, destination.id]))).toThrow('video-aware');
    expect(() => routePrototype(route, action, new Set([f.screen.id, destination.id]))).toThrow('video-aware');
    expect(route).toEqual(before); expect(route.history).toBe(history); expect(route.overlays).toBe(overlays);
  }
});

function componentClip(parent: SceneNode) {
  const id = placePreparedVideo(source, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Instance video', width: 80, height: 45, duration: 3 }, 0, 30);
  source.graph.reparentNode(id, parent.id); return source.graph.getNode(id)!;
}

it('resolves template-authored media to each of two actual component occurrences and rejects an ambiguous outer alias', () => {
  const graph = source.graph, page = source.state.currentPageId;
  const main = graph.createNode('COMPONENT', page, { name: 'Media component', width: 100, height: 90, fills: [] });
  const button = graph.createNode('RECTANGLE', main.id, { name: 'Instance playback', width: 80, height: 24, fills: [] }), clip = componentClip(main);
  setNavigation(source, button, media(clip.id, 'play'));
  const screen = graph.createNode('FRAME', page, { name: 'Two video occurrences', width: 320, height: 240, fills: [] });
  const instances = [graph.createInstance(main.id, screen.id)!, graph.createInstance(main.id, screen.id, { x: 130 })!];
  const actualVideos = instances.map(instance => graph.getChildren(instance.id).find(node => node.componentId === clip.id)!);
  expect(actualVideos[0]!.id).not.toBe(actualVideos[1]!.id);
  for (const instance of instances) expect(readPrototype(graph.getChildren(instance.id).find(node => node.name === button.name)!).link?.target).toBe(clip.id);
  const outside = graph.createNode('RECTANGLE', screen.id, { name: 'Ambiguous inherited action', y: 150, width: 80, height: 24, fills: [], pluginData: structuredClone(button.pluginData) });
  const before = serializeGraph(graph);
  for (const presentation of [false, true]) {
    const model = selectionToDesignModel(graph, [screen.id], undefined, presentation);
    for (let index = 0; index < 2; index++) {
      const occurrence = model.nodes[0]!.children[index]!, ownVideo = occurrence.children.find(node => node.video)!, ownButton = occurrence.children.find(node => node.name === button.name)!;
      expect(ownButton.navigation).toEqual(media(ownVideo.id, 'play')); expect(ownVideo.id).toBe(`${screen.id}/${index}/1`);
      expect(ownButton.navigation?.target).not.toBe(`${screen.id}/${1 - index}/1`);
    }
    const outer = model.nodes[0]!.children.find(node => node.name === outside.name)!;
    expect(outer.navigation).toEqual({ ...media(clip.id, 'play'), unresolved: true });
    expect(model.prototypeIssues).toContain(`${outside.name}: Its video target is ambiguous between component occurrences.`);
  }
  expect(serializeGraph(graph)).toBe(before);
});

it('keeps each reordered interactive variant template target in its own tree when the SDK replaces child identities', () => {
  const graph = source.graph, page = source.state.currentPageId;
  const set = graph.createNode('COMPONENT_SET', page, { name: 'Video action states' }); source.addPropertyDefinition(set.id, 'State', 'VARIANT', 'Default');
  const variants = ['Default', 'Hover'].map((state, index) => {
    const main = graph.createNode('COMPONENT', set.id, { name: state, width: 110, height: 90, fills: [], componentPropertyValues: { State: state } });
    const clip = index ? componentClip(main) : undefined;
    const button = graph.createNode('RECTANGLE', main.id, { name: 'Variant playback', width: 80, height: 24, fills: [] }), video = clip ?? componentClip(main);
    setNavigation(source, button, media(video.id, 'toggle')); return main;
  });
  setComponentBehaviour(source, set, { kind: 'button', states: 'State' });
  const screen = graph.createNode('FRAME', page, { name: 'Repeated stateful video', width: 320, height: 240, fills: [] });
  const instances = [graph.createInstance(variants[0]!.id, screen.id)!, graph.createInstance(variants[0]!.id, screen.id, { x: 140 })!];
  const before = serializeGraph(graph), model = selectionToDesignModel(graph, [screen.id], undefined, true); expect(model.prototypeIssues).toEqual([]);
  for (const [index, instance] of instances.entries()) {
    const exported = model.nodes[0]!.children[index]!; expect(exported.sourceId).toBe(instance.id); expect(exported.control?.variants).toHaveLength(2);
    const [rest, hover] = exported.control!.variants, restVideo = rest!.tree.children.find(node => node.video)!, hoverVideo = hover!.tree.children.find(node => node.video)!;
    expect(restVideo.sourceId).toBe(graph.getChildren(instance.id).find(node => node.fills.some(fill => fill.type === 'VIDEO'))!.id);
    expect(restVideo.sourceId).not.toBe(hoverVideo.sourceId); expect(restVideo.id).toBe(`${screen.id}/${index}/1`); expect(hoverVideo.id).toBe(`${screen.id}/${index}/0`);
    for (const variant of [rest!, hover!]) {
      const ownVideo = variant.tree.children.find(node => node.video)!, ownButton = variant.tree.children.find(node => node.name === 'Variant playback')!;
      expect(ownButton.navigation).toEqual(media(ownVideo.id, 'toggle'));
      expect(ownButton.navigation?.target).not.toBe(`${screen.id}/${1 - index}/0`);
      expect(ownButton.navigation?.target).not.toBe(`${screen.id}/${1 - index}/1`);
    }
  }
  expect(resolveNativeReactScreens(graph, screen.id)).toEqual([screen.id]); expect(serializeGraph(graph)).toBe(before);
  const foreignButton = graph.getChildren(variants[1]!.id).find(node => node.name === 'Variant playback')!, foreignVideo = graph.getChildren(variants[1]!.id).find(node => node.fills.some(fill => fill.type === 'VIDEO'))!;
  const actualButton = graph.getChildren(instances[0]!.id).find(node => node.name === 'Variant playback')!;
  graph.updateNode(actualButton.id, { pluginData: structuredClone(foreignButton.pluginData) });
  const foreignBefore = serializeGraph(graph), foreignModel = selectionToDesignModel(graph, [screen.id], undefined, true), control = foreignModel.nodes[0]!.children[0]!.control!;
  const defaultButton = control.variants[0]!.tree.children.find(node => node.name === 'Variant playback')!;
  expect(defaultButton.navigation).toEqual({ ...media(foreignVideo.id, 'toggle'), unresolved: true });
  expect(foreignModel.prototypeIssues).toContain('Variant playback: Its video target is not available in this component variant.');
  const currentHover = control.variants[1]!.tree, hoverVideo = currentHover.children.find(node => node.video)!, hoverButton = currentHover.children.find(node => node.name === 'Variant playback')!;
  expect(hoverButton.navigation).toEqual(media(hoverVideo.id, 'toggle')); expect(serializeGraph(graph)).toBe(foreignBefore);
});

it('keeps owned slot video identities scoped to their reordered variant paths in two actual component instances', () => {
  const graph = source.graph, page = source.state.currentPageId; installSlotSupport(graph);
  const set = graph.createNode('COMPONENT_SET', page, { name: 'Owned media states' }); source.addPropertyDefinition(set.id, 'State', 'VARIANT', 'Default');
  const variants = ['Default', 'Hover'].map((state, index) => {
    const main = graph.createNode('COMPONENT', set.id, { name: state, width: 110, height: 90, fills: [], componentPropertyValues: { State: state } });
    const ornament = () => graph.createNode('RECTANGLE', main.id, { name: 'State ornament', width: 5, height: 5, fills: [] });
    if (!index) ornament();
    const slot = graph.createNode('FRAME', main.id, { name: 'Playback content', width: 100, height: 80, fills: [] });
    const button = graph.createNode('RECTANGLE', slot.id, { name: 'Owned playback', width: 80, height: 24, fills: [] }), video = componentClip(slot);
    setNavigation(source, button, media(video.id, 'toggle')); createSlot(source, slot);
    if (index) ornament();
    return main;
  });
  setComponentBehaviour(source, set, { kind: 'button', states: 'State' });
  const screen = graph.createNode('FRAME', page, { name: 'Repeated owned media', width: 320, height: 240, fills: [] });
  const instances = [graph.createInstance(variants[0]!.id, screen.id)!, graph.createInstance(variants[0]!.id, screen.id, { x: 140 })!];
  const owned = instances.map(instance => {
    const slot = instanceSlotFrames(graph, instance)[0]!; claimSlotContent(graph, slot);
    const button = graph.getChildren(slot.id).find(node => node.name === 'Owned playback')!, video = graph.getChildren(slot.id).find(node => node.fills.some(fill => fill.type === 'VIDEO'))!;
    expect(video.componentId).toBeNull(); setNavigation(source, button, media(video.id, 'toggle'));
    return { button: button.id, video: video.id };
  });
  expect(owned[0]!.video).not.toBe(owned[1]!.video);
  const before = serializeGraph(graph), model = selectionToDesignModel(graph, [screen.id], undefined, true); expect(model.prototypeIssues).toEqual([]);
  for (const [index, instance] of instances.entries()) {
    const exported = model.nodes[0]!.children[index]!; expect(exported.sourceId).toBe(instance.id); expect(exported.control?.variants).toHaveLength(2);
    const [rest, hover] = exported.control!.variants;
    for (const [stateIndex, variant] of [rest!, hover!].entries()) {
      const content = variant.tree.children.find(node => node.name === 'Playback content')!, video = content.children.find(node => node.video)!, button = content.children.find(node => node.name === 'Owned playback')!;
      const expected = `${screen.id}/${index}/${stateIndex ? 0 : 1}/1`;
      expect(video.sourceId).toBe(owned[index]!.video); expect(button.sourceId).toBe(owned[index]!.button); expect(video.id).toBe(expected);
      expect(button.navigation).toEqual(media(expected, 'toggle')); expect(button.navigation?.target).not.toContain(`${screen.id}/${1 - index}/`);
    }
    const restVideo = rest!.tree.children.find(node => node.name === 'Playback content')!.children.find(node => node.video)!, hoverVideo = hover!.tree.children.find(node => node.name === 'Playback content')!.children.find(node => node.video)!;
    expect(restVideo.sourceId).toBe(hoverVideo.sourceId); expect(restVideo.id).not.toBe(hoverVideo.id);
  }
  expect(resolveNativeReactScreens(graph, screen.id)).toEqual([screen.id]); expect(serializeGraph(graph)).toBe(before);
  for (const [index, instance] of instances.entries()) expect(graph.getChildren(instanceSlotFrames(graph, instance)[0]!.id).map(node => node.id)).toEqual([owned[index]!.button, owned[index]!.video]);
});
