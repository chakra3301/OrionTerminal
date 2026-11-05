import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { allDesignActions, openDesignUrl, type DesignNavigation } from './reactExportRuntime';
import { readPrototype, setNavigation, setPrototypeInteractions } from './prototype';
import { navigatePrototype, routePrototype } from './prototypeRouteRuntime';
import { resolveNativeReactScreens } from './nativeReactScreens';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { installPrototypeEditing } from './prototypeEditing';
import { deserializeGraph, serializeGraph } from './document';
import { withClipboardVideoResources } from './videoClipboard';

let source: Editor, target: Editor;
beforeEach(() => { source=createEditor(); target=createEditor(); installPrototypeEditing(source); installPrototypeEditing(target); });
afterEach(() => {source.dispose(); target.dispose();});
const url='https://example.test/design/23:7?target=23%3A7&label=%F0%9F%8E%A8#screen';
function fixture(newTab?: boolean) {
  const graph=source.graph, page=source.state.currentPageId;
  const screen=graph.createNode('FRAME',page,{name:'URL root',width:160,height:100,fills:[]}), other=graph.createNode('FRAME',page,{name:'Unrelated URL lookalike',id:'23:7',width:80,height:60,fills:[]});
  const hotspot=graph.createNode('RECTANGLE',screen.id,{name:'External help',width:80,height:24,fills:[]});
  const action:DesignNavigation={action:'open-url',url,transition:'instant',duration:0,...(newTab===undefined?{}:{newTab})};
  setNavigation(source,hotspot,action); return {graph,screen,other,hotspot,action};
}
function links(editor: Editor, id: string) {
  const node=editor.graph.getNode(id)!; return (readPrototype(node).interactions??[]).flatMap(interaction=>allDesignActions(interaction.navigation)).filter(action=>action.action==='open-url');
}

it.each([undefined,false,true])('keeps Open link newTab=%s opaque to portable stable IDs and native screen closure',newTab=>{
  const f=fixture(newTab), before=serializeGraph(f.graph), original=f.hotspot.pluginData;
  const model=selectionToDesignModel(f.graph,[f.screen.id]); expect(model.prototypeIssues).toEqual([]);
  const exported=model.nodes[0]!.children.find(node=>node.name==='External help')!;
  expect(exported.navigation).toEqual(f.action); expect(exported.navigation).not.toHaveProperty('target'); expect(exported.navigation).not.toHaveProperty('unresolved');
  expect(exported.id).not.toBe(f.hotspot.id); expect(resolveNativeReactScreens(f.graph,f.screen.id)).toEqual([f.screen.id]);
  const delivered=selectionToReact(f.graph,[f.screen.id]); expect(delivered.code).toContain(url); expect(delivered.code).toContain('onOpenUrl');
  expect(serializeGraph(f.graph)).toBe(before); expect(f.hotspot.pluginData).toBe(original);
});

it('includes only real frame dependencies for conditional sequences containing URLs and preserves action order',()=>{
  const f=fixture(false), destination=f.graph.createNode('FRAME',source.state.currentPageId,{name:'Actual reachable route',width:80,height:60,fills:[]});
  setPrototypeInteractions(source,f.hotspot,[{id:'combined',trigger:{type:'click'},navigation:{action:'sequence',transition:'instant',duration:0,actions:[f.action,{action:'conditional',transition:'instant',duration:0,branches:[{condition:{type:'literal',value:true},actions:[{action:'navigate',target:destination.id,transition:'instant',duration:0}]},{actions:[{...f.action,url:'mailto:design@example.test?subject=Review'}]}]}]}}]);
  const before=serializeGraph(f.graph); expect(resolveNativeReactScreens(f.graph,f.screen.id)).toEqual([f.screen.id,destination.id]);
  const model=selectionToDesignModel(f.graph,[f.screen.id]), actions=allDesignActions(model.nodes[0]!.children.find(node=>node.name==='External help')!.interactions![0]!.navigation);
  expect(actions.map(action=>action.action)).toEqual(['open-url','conditional','navigate','open-url']); expect(actions.filter(action=>action.action==='open-url').map(action=>action.url)).toEqual([url,'mailto:design@example.test?subject=Review']);
  expect(serializeGraph(f.graph)).toBe(before);
});

it.each([undefined,false,true])('duplicate, closed-session snapshot and HTML paste preserve URL/newTab=%s without GUID remapping',async newTab=>{
  const f=fixture(newTab); source.select([f.screen.id]); const original=serializeGraph(f.graph);
  source.duplicateSelected(); const copy=source.getSelectedNodes()[0]!; expect(links(source,copy.childIds[0]!)).toEqual([f.action]); expect(links(source,f.hotspot.id)).toEqual([f.action]);
  source.undoAction(); expect(serializeGraph(f.graph)).toBe(original); source.redoAction(); expect(links(source,source.getSelectedNodes()[0]!.childIds[0]!)).toEqual([f.action]); source.undoAction(); source.select([f.screen.id]);
  const payload=await source.prepareCopy(); withClipboardVideoResources(f.graph,payload); const snapshot=structuredClone(payload.snapshot!), snapshotBefore=structuredClone(snapshot);
  await target.pasteSnapshot(snapshot); const pasted=target.getSelectedNodes()[0]!; expect(links(target,pasted.childIds[0]!)).toEqual([f.action]); expect(snapshot).toEqual(snapshotBefore);
  target.undoAction(); expect(target.graph.getNode(pasted.id)).toBeUndefined(); target.redoAction(); expect(links(target,pasted.childIds[0]!)).toEqual([f.action]); target.undoAction();
  await target.pasteFromHTML(payload.html); const html=target.getSelectedNodes()[0]!; expect(links(target,html.childIds[0]!)).toEqual([f.action]);
  const reopened=deserializeGraph(serializeGraph(target.graph)); expect(readPrototype(reopened.getNode(html.childIds[0]!)!).link).toEqual(f.action);
  expect(serializeGraph(f.graph)).toBe(original);
});

it('refuses direct URL route execution even with a forged screen target and leaves route arrays untouched',()=>{
  const f=fixture(false), history=['previous'], overlays=[{screen:f.other.id,origin:{x:2,y:3},offset:{x:4,y:5},instanceId:'same-overlay'}], route={screen:f.screen.id,history,overlays}, before=structuredClone(route);
  for(const action of [f.action,{...f.action,target:f.other.id}]) {
    expect(()=>navigatePrototype(f.screen.id,history,action,new Set([f.screen.id,f.other.id]))).toThrow('external-link');
    expect(()=>routePrototype(route,action,new Set([f.screen.id,f.other.id]))).toThrow('external-link');
    expect(route).toEqual(before); expect(route.history).toBe(history); expect(route.overlays).toBe(overlays);
  }
});

it('uses the exact current-tab address in the shared browser policy and refuses unsafe protocols before browser calls',async()=>{
  const f=fixture(false), assign=vi.fn(), open=vi.fn();
  vi.stubGlobal('window',{location:{assign},open});
  try {
    const completion=openDesignUrl(f.action); expect(assign).toHaveBeenCalledExactlyOnceWith(url); expect(open).not.toHaveBeenCalled(); expect(await completion).toBe(true);
    for(const value of ['javascript:alert(1)','data:text/html,example','file:///tmp/design','/relative','https://example.test/\nunsafe']) await expect(openDesignUrl({...f.action,url:value})).rejects.toThrow();
    expect(assign).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
  } finally {vi.unstubAllGlobals();}
});
