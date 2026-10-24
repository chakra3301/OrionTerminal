import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { serializeGraph, deserializeGraph } from './document';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { setPrototypeInteractions, readPrototype, prototypeResolver, prototypeStart, readNavigation, setNavigation, setPrototypeStart } from './prototype';
import { readPrototypeOverlay, setPrototypeOverlay } from './prototypeOverlay';

let editor: Editor;
beforeEach(() => { editor = createEditor(); }); afterEach(() => editor.dispose());

it.each([['PLAY','play'],['PAUSE','pause'],['TOGGLE_PLAY_PAUSE','toggle']] as const)('round-trips targeted native video %s through actual FIG GUIDs without plugin metadata', async (native,operation) => {
  const graph=editor.graph, screen=graph.createNode('FRAME',editor.state.currentPageId,{name:'Media screen'}), video=graph.createNode('RECTANGLE',screen.id,{name:'Actual video target',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}), button=graph.createNode('RECTANGLE',screen.id,{name:'Native video button'});
  video.source.id='81:27';
  const raw={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:native,transitionNodeID:{sessionID:81,localID:27}}]}]};button.source.fig.rawNodeFields=structuredClone(raw);
  const before=serializeGraph(graph), undo=editor.undo.canUndo;
  expect(readNavigation(button,prototypeResolver(graph))).toEqual({action:'media',mediaAction:operation,target:video.id,transition:'instant',duration:0});
  const bytes=await exportFigImageCompatible(deserializeGraph(before)), parsed=parseFigBuffer(new Uint8Array(bytes).buffer);
  const target=parsed.nodeChanges.find(node=>node.name===video.name)!;
  const actions=(parsed.nodeChanges.find(node=>node.name===button.name)!.prototypeInteractions as {actions:Record<string,unknown>[]}[])[0]!.actions;
  expect(actions).toEqual([{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:native,transitionNodeID:target.guid}]);
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer), restored=[...reopened.nodes.values()].find(node=>node.name===button.name)!, restoredVideo=[...reopened.nodes.values()].find(node=>node.name===video.name)!;
  reopened.nodes.forEach(node=>{node.pluginData=[];});
  expect(readNavigation(restored,prototypeResolver(reopened))).toEqual({action:'media',mediaAction:operation,target:restoredVideo.id,transition:'instant',duration:0});
  expect(serializeGraph(graph)).toBe(before);expect(editor.undo.canUndo).toBe(undo);expect(button.source.fig.rawNodeFields).toEqual(raw);
});

it('writes authored video sequences and conditional branch targets as native media actions with exact Undo/Redo', async () => {
  const graph=editor.graph, screen=graph.createNode('FRAME',editor.state.currentPageId,{name:'Authored media screen'}), video=graph.createNode('RECTANGLE',screen.id,{name:'Authored media target',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}), button=graph.createNode('RECTANGLE',screen.id,{name:'Authored media sequence'});
  editor.updateNodeWithUndo(button.id,{pluginData:[{pluginId:'vendor',key:'keep',value:'Media authoring metadata'}]},'Author media fixture');editor.undo.clear();
  const media=(mediaAction:'play'|'pause'|'toggle')=>({action:'media' as const,mediaAction,target:video.id,transition:'instant' as const,duration:0});
  const navigation={action:'sequence' as const,transition:'instant' as const,duration:0,actions:[media('play'),{action:'conditional' as const,transition:'instant' as const,duration:0,branches:[{condition:{type:'literal' as const,value:true},actions:[media('pause')]},{actions:[media('toggle')]}]}]};
  const original=serializeGraph(graph);setNavigation(editor,button,navigation);const authored=serializeGraph(graph);
  editor.undoAction();expect(serializeGraph(graph)).toBe(original);editor.redoAction();expect(serializeGraph(graph)).toBe(authored);
  const bytes=await exportFigImageCompatible(deserializeGraph(authored)), parsed=parseFigBuffer(new Uint8Array(bytes).buffer), guid=parsed.nodeChanges.find(node=>node.name===video.name)!.guid;
  const actions=(parsed.nodeChanges.find(node=>node.name===button.name)!.prototypeInteractions as {actions:Record<string,unknown>[]}[])[0]!.actions;
  expect(actions).toMatchObject([{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'PLAY',transitionNodeID:guid},{connectionType:'CONDITIONAL',conditionalActions:[{actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'PAUSE',transitionNodeID:guid}]},{actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'TOGGLE_PLAY_PAUSE',transitionNodeID:guid}]}]}]);
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer), restored=[...reopened.nodes.values()].find(node=>node.name===button.name)!, restoredVideo=[...reopened.nodes.values()].find(node=>node.name===video.name)!;
  reopened.nodes.forEach(node=>{node.pluginData=[];});
  const read=readNavigation(restored,prototypeResolver(reopened))!;expect(read.actions?.[0]).toMatchObject({action:'media',mediaAction:'play',target:restoredVideo.id});expect(read.actions?.[1]?.branches?.[0]?.actions[0]).toMatchObject({action:'media',mediaAction:'pause',target:restoredVideo.id});
  expect(serializeGraph(graph)).toBe(authored);
});

it('preserves unsupported native media transport fields in actual FIG output without accepting partial playback', async () => {
  const graph=editor.graph, screen=graph.createNode('FRAME',editor.state.currentPageId,{name:'Unsupported media'}), button=graph.createNode('RECTANGLE',screen.id,{name:'Unproven seek action'});
  const raw={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'SKIP_TO',mediaSkipToTime:1.25,transitionNodeID:{sessionID:71,localID:3}}]}]};button.source.fig.rawNodeFields=structuredClone(raw);
  const before=serializeGraph(graph);expect(readPrototype(button).issue).toContain('preserved');
  const bytes=await exportFigImageCompatible(deserializeGraph(before)), parsed=parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(parsed.nodeChanges.find(node=>node.name===button.name)!.prototypeInteractions).toEqual(raw.prototypeInteractions);
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer), restored=[...reopened.nodes.values()].find(node=>node.name===button.name)!;restored.pluginData=[];
  expect(readPrototype(restored).issue).toContain('preserved');expect(serializeGraph(graph)).toBe(before);
});
it('writes inherited component video actions to each actual instance GUID through plugin-free FIG reopening', async () => {
  const graph=editor.graph, page=editor.state.currentPageId, main=graph.createNode('COMPONENT',page,{name:'Media template'}), video=graph.createNode('RECTANGLE',main.id,{name:'Inherited FIG video',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}), button=graph.createNode('RECTANGLE',main.id,{name:'Inherited FIG button'});
  setNavigation(editor,button,{action:'media',mediaAction:'pause',target:video.id,transition:'instant',duration:0});
  const screen=graph.createNode('FRAME',page,{name:'Instance FIG screen'}), instances=[graph.createInstance(main.id,screen.id,{name:'First media instance'})!,graph.createInstance(main.id,screen.id,{name:'Second media instance'})!];
  for(const instance of instances)expect(readNavigation(graph.getChildren(instance.id).find(node=>node.componentId===button.id)!)?.target).toBe(video.id);
  const firstButton=graph.getChildren(instances[0]!.id).find(node=>node.componentId===button.id)!,firstVideo=graph.getChildren(instances[0]!.id).find(node=>node.componentId===video.id)!;
  setNavigation(editor,firstButton,{action:'media',mediaAction:'play',target:firstVideo.id,transition:'instant',duration:0});
  const before=serializeGraph(graph), bytes=await exportFigImageCompatible(deserializeGraph(before)), parsed=parseFigBuffer(new Uint8Array(bytes).buffer), reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer);
  const nativeButton=parsed.nodeChanges.find(node=>node.name===button.name)!,nativeVideo=parsed.nodeChanges.find(node=>node.name===video.name)!;
  for(const [index,instance] of instances.entries()) {
    const native=parsed.nodeChanges.find(node=>node.name===instance.name)!,data=native.symbolData as {symbolOverrides?:{guidPath?:{guids?:unknown[]};prototypeInteractions?:unknown[]}[]};
    expect(data.symbolOverrides).toContainEqual(expect.objectContaining({guidPath:{guids:[nativeButton.guid]},prototypeInteractions:[expect.objectContaining({event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:index?'PAUSE':'PLAY',transitionNodeID:nativeVideo.guid}]})]}));
  }
  reopened.nodes.forEach(node=>{node.pluginData=[];});
  for(const [index,instance] of instances.entries()) {
    const restored=[...reopened.nodes.values()].find(node=>node.name===instance.name)!, ownVideo=reopened.getChildren(restored.id).find(node=>node.name===video.name)!, ownButton=reopened.getChildren(restored.id).find(node=>node.name===button.name)!;
    expect(ownVideo).toBeDefined();expect(ownButton).toBeDefined();expect(readNavigation(ownButton,prototypeResolver(reopened))).toEqual({action:'media',mediaAction:index?'pause':'play',target:ownVideo.id,transition:'instant',duration:0});
  }
  expect(serializeGraph(graph)).toBe(before);
});

it('writes exact nested frame GUID paths while preserving unrelated instance overrides and definition identities', async () => {
  const graph=editor.graph,page=editor.state.currentPageId,main=graph.createNode('COMPONENT',page,{name:'Nested media template'}),outer=graph.createNode('FRAME',main.id,{name:'Media outer frame'}),inner=graph.createNode('FRAME',outer.id,{name:'Media inner frame'});
  const video=graph.createNode('RECTANGLE',inner.id,{name:'Nested FIG video',overrideKey:'73:3',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}),button=graph.createNode('RECTANGLE',inner.id,{name:'Nested FIG button',overrideKey:'73:2'});
  setNavigation(editor,button,{action:'media',mediaAction:'toggle',target:video.id,transition:'instant',duration:0});
  const screen=graph.createNode('FRAME',page,{name:'Nested occurrence screen'}),instances=[graph.createInstance(main.id,screen.id,{name:'First nested occurrence'})!,graph.createInstance(main.id,screen.id,{name:'Second nested occurrence'})!];
  const descend=(id:string,definition:string):ReturnType<typeof graph.getNode>=>{const pending=[id];while(pending.length){const node=graph.getNode(pending.pop()!)!;if(node.componentId===definition)return node;pending.push(...node.childIds);}return undefined;};
  const ownButton=descend(instances[0]!.id,button.id)!,ownVideo=descend(instances[0]!.id,video.id)!;
  setNavigation(editor,ownButton,{action:'media',mediaAction:'pause',target:ownVideo.id,transition:'instant',duration:0});
  const before=serializeGraph(graph),isolated=deserializeGraph(before);
  // Preserve an unrelated native override at the exact same actor path.
  const seed=await exportFigImageCompatible(deserializeGraph(before)),seedParsed=parseFigBuffer(new Uint8Array(seed).buffer),named=(name:string)=>seedParsed.nodeChanges.find(node=>node.name===name)!;
  const preservedInteraction={id:{sessionID:4294967293,localID:1},event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'SKIP_TO',mediaSkipToTime:1.25,transitionNodeID:named(video.name).guid!}]};
  isolated.getNode(instances[0]!.id)!.source.fig.symbolOverrides=[{guidPath:{guids:[named(outer.name).guid!,named(inner.name).guid!,{sessionID:73,localID:2}]},opacity:.375},{guidPath:{guids:[named(outer.name).guid!]},prototypeInteractions:[preservedInteraction]}];
  const isolatedBefore=serializeGraph(isolated),bytes=await exportFigImageCompatible(deserializeGraph(isolatedBefore)),parsed=parseFigBuffer(new Uint8Array(bytes).buffer),record=(name:string)=>parsed.nodeChanges.find(node=>node.name===name)!;
  const expectedPath=[record(outer.name).guid,record(inner.name).guid,{sessionID:73,localID:2}],target=record(video.name).guid;
  expect(target).not.toEqual({sessionID:73,localID:3});
  for(const [index,instance] of instances.entries()) {
    const data=record(instance.name).symbolData as {symbolOverrides?:{guidPath?:{guids?:unknown[]};opacity?:number;prototypeInteractions?:unknown[]}[]};
    const override=data.symbolOverrides!.find(item=>JSON.stringify(item.guidPath?.guids)===JSON.stringify(expectedPath))!;
    expect(override).toBeDefined();expect(override.prototypeInteractions).toMatchObject([{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:index?'TOGGLE_PLAY_PAUSE':'PAUSE',transitionNodeID:target}]}]);
    for(const interaction of override.prototypeInteractions as {id?:unknown}[])expect(interaction.id).not.toEqual(preservedInteraction.id);
    if(!index){expect(override.opacity).toBe(.375);expect(data.symbolOverrides!.find(item=>JSON.stringify(item.guidPath?.guids)===JSON.stringify([record(outer.name).guid]))?.prototypeInteractions).toEqual([preservedInteraction]);}
  }
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer);reopened.nodes.forEach(node=>{node.pluginData=[];});
  for(const [index,instance] of instances.entries()) {
    const restored=[...reopened.nodes.values()].find(node=>node.name===instance.name)!,pending=[restored.id],descendants=[];
    while(pending.length){const node=reopened.getNode(pending.pop()!)!;descendants.push(node);pending.push(...node.childIds);}
    const actualButton=descendants.find(node=>node.name===button.name)!,actualVideo=descendants.find(node=>node.name===video.name)!;
    expect(readNavigation(actualButton,prototypeResolver(reopened))).toEqual({action:'media',mediaAction:index?'toggle':'pause',target:actualVideo.id,transition:'instant',duration:0});
  }
  expect(serializeGraph(graph)).toBe(before);expect(serializeGraph(isolated)).toBe(isolatedBefore);
});

it('refuses an explicit media target in a peer instance instead of encoding an ambiguous definition GUID', async () => {
  const graph=editor.graph,page=editor.state.currentPageId,main=graph.createNode('COMPONENT',page,{name:'Peer target template'}),video=graph.createNode('RECTANGLE',main.id,{name:'Peer video',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}),button=graph.createNode('RECTANGLE',main.id,{name:'Peer action'});
  const screen=graph.createNode('FRAME',page,{name:'Peer target screen'}),first=graph.createInstance(main.id,screen.id)!,second=graph.createInstance(main.id,screen.id)!;
  const actor=graph.getChildren(first.id).find(node=>node.componentId===button.id)!,other=graph.getChildren(second.id).find(node=>node.componentId===video.id)!;
  setNavigation(editor,actor,{action:'media',mediaAction:'play',target:other.id,transition:'instant',duration:0});
  const before=serializeGraph(graph);await expect(exportFigImageCompatible(deserializeGraph(before))).rejects.toThrow('no exported identity in this instance occurrence');expect(serializeGraph(graph)).toBe(before);
  setNavigation(editor,actor,null);
  const inner=graph.createNode('COMPONENT',page,{name:'Nested peer media'}),innerVideo=graph.createNode('RECTANGLE',inner.id,{name:'Nested peer video',fills:[{type:'VIDEO',visible:true,opacity:1,color:{r:0,g:0,b:0,a:1}}]}),outer=graph.createNode('COMPONENT',page,{name:'Outer peer media'}),outerButton=graph.createNode('RECTANGLE',outer.id,{name:'Outer peer action'});
  const nestedDefinition=graph.createInstance(inner.id,outer.id)!,nestedVideoDefinition=graph.getChildren(nestedDefinition.id).find(node=>node.componentId===innerVideo.id)!;
  const occurrence=graph.createInstance(outer.id,screen.id)!;
  const actualButton=graph.getChildren(occurrence.id).find(node=>node.componentId===outerButton.id)!,nested=graph.getChildren(occurrence.id).find(node=>node.componentId===nestedDefinition.id)!,nestedVideo=graph.getChildren(nested.id).find(node=>node.componentId===nestedVideoDefinition.id)!;
  expect(nested.componentId).toBe(nestedDefinition.id);expect(nestedVideo.componentId).toBe(nestedVideoDefinition.id);
  setNavigation(editor,actualButton,{action:'media',mediaAction:'pause',target:nestedVideo.id,transition:'instant',duration:0});
  const nestedBefore=serializeGraph(graph);await expect(exportFigImageCompatible(deserializeGraph(nestedBefore))).rejects.toThrow('no exported identity in this instance occurrence');expect(serializeGraph(graph)).toBe(nestedBefore);
});

it.each([undefined, false, true])('round-trips native URL and new-tab=%s through actual FIG bytes without a destination GUID or plugin fallback', async newTab => {
  const graph = editor.graph, page = editor.state.currentPageId, screen = graph.createNode('FRAME', page, { name: 'URL screen' });
  const node = graph.createNode('TEXT', screen.id, { name: 'Native URL action', text: 'Documentation' });
  const url = 'https://user:password@example.com/docs?q=a%20b&return=%2Fhelp#section';
  const raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'URL', connectionURL: url, ...(newTab === undefined ? {} : { openUrlInNewTab: newTab }) }] }] };
  node.source.fig.rawNodeFields = structuredClone(raw);
  const expected = { action: 'open-url', url, ...(newTab === undefined ? {} : { newTab }), transition: 'instant', duration: 0 };
  const before = serializeGraph(graph), canUndo = editor.undo.canUndo;
  expect(readNavigation(node, prototypeResolver(graph))).toEqual(expected);
  const bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  const actions = (parsed.nodeChanges.find(record => record.name === node.name)!.prototypeInteractions as { actions: Record<string, unknown>[] }[])[0]!.actions;
  expect(actions).toHaveLength(1); expect(actions[0]).toMatchObject({ connectionType: 'URL', connectionURL: url });
  expect(Object.hasOwn(actions[0]!, 'openUrlInNewTab')).toBe(newTab !== undefined);
  if (newTab !== undefined) expect(actions[0]!.openUrlInNewTab).toBe(newTab);
  expect(Object.hasOwn(actions[0]!, 'transitionNodeID')).toBe(false);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), restored = [...reopened.nodes.values()].find(record => record.name === node.name)!;
  reopened.nodes.forEach(record => { record.pluginData = []; });
  expect(readNavigation(restored, prototypeResolver(reopened))).toEqual(expected);
  expect(serializeGraph(graph)).toBe(before); expect(editor.undo.canUndo).toBe(canUndo); expect(node.source.fig.rawNodeFields).toEqual(raw);
});

it('writes authored URL sequences and conditional branches as native URL actions, retaining source and Undo/Redo', async () => {
  const graph = editor.graph, screen = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Authored URL screen' });
  const node = graph.createNode('TEXT', screen.id, { name: 'Authored URL sequence', text: 'Review' });
  editor.updateNodeWithUndo(node.id, { pluginData: [{ pluginId: 'vendor', key: 'retain', value: 'URL fixture metadata' }] }, 'Author fixture metadata');
  editor.undo.clear();
  const first = { action: 'open-url' as const, url: 'mailto:review@example.com?subject=Design%20review', newTab: false, transition: 'instant' as const, duration: 0 };
  const second = { action: 'open-url' as const, url: 'tel:+15551234567', transition: 'instant' as const, duration: 0 };
  const third = { action: 'open-url' as const, url: 'https://example.com/approved', newTab: true, transition: 'instant' as const, duration: 0 };
  const navigation = { action: 'sequence' as const, transition: 'instant' as const, duration: 0, actions: [first, { action: 'conditional' as const, transition: 'instant' as const, duration: 0, branches: [{ condition: { type: 'literal' as const, value: true }, actions: [second] }, { actions: [third] }] }] };
  const original = serializeGraph(graph); setNavigation(editor, node, navigation); const before = serializeGraph(graph);
  editor.undoAction(); expect(serializeGraph(graph)).toBe(original); editor.redoAction(); expect(readNavigation(node)).toEqual(navigation);
  const bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  const actions = (parsed.nodeChanges.find(record => record.name === node.name)!.prototypeInteractions as { actions: Record<string, unknown>[] }[])[0]!.actions;
  expect(actions).toMatchObject([{ connectionType: 'URL', connectionURL: first.url, openUrlInNewTab: false }, { connectionType: 'CONDITIONAL', conditionalActions: [{ actions: [{ connectionType: 'URL', connectionURL: second.url }] }, { actions: [{ connectionType: 'URL', connectionURL: third.url, openUrlInNewTab: true }] }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), restored = [...reopened.nodes.values()].find(record => record.name === node.name)!;
  reopened.nodes.forEach(record => { record.pluginData = []; });
  expect(readNavigation(restored, prototypeResolver(reopened))).toEqual(navigation); expect(serializeGraph(graph)).toBe(before);
});

it('recovers a schema-native legacy URL without introducing screen references during FIG export', async () => {
  const graph = editor.graph, node = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Legacy external URL' });
  node.source.fig.rawNodeFields = { connectionType: 'URL', connectionURL: 'http://localhost:8123/help#part', openUrlInNewTab: false, interactionType: 'ON_CLICK' };
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before));
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), restored = [...reopened.nodes.values()].find(record => record.name === node.name)!;
  restored.pluginData = [];
  expect(readNavigation(restored)).toEqual({ action: 'open-url', url: 'http://localhost:8123/help#part', newTab: false, transition: 'instant', duration: 0 });
  expect(serializeGraph(graph)).toBe(before);
});

it('preserves unsupported dynamic native URL data without treating its static URL as complete playback', async () => {
  const graph = editor.graph, node = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Dynamic native URL' });
  const raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'URL', connectionURL: 'https://example.com/static', linkParam: { dataType: 'STRING', value: { textValue: 'dynamic suffix' } } }] }] };
  node.source.fig.rawNodeFields = structuredClone(raw); const before = serializeGraph(graph);
  expect(readPrototype(node).issue).toBeTruthy();
  const bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(parsed.nodeChanges.find(record => record.name === node.name)!.prototypeInteractions).toEqual(raw.prototypeInteractions);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), restored = [...reopened.nodes.values()].find(record => record.name === node.name)!;
  restored.pluginData = []; expect(readPrototype(restored).issue).toBeTruthy(); expect(serializeGraph(graph)).toBe(before);
});

it('writes schema-native actions and start GUIDs, then reopens them with correct local destinations', async () => {
  const graph = editor.graph, page = editor.state.currentPageId;
  const first = graph.createNode('FRAME', page, { name: 'Home' }), second = graph.createNode('FRAME', page, { name: 'Details' });
  const next = graph.createNode('RECTANGLE', first.id, { name: 'Next' }), back = graph.createNode('RECTANGLE', second.id, { name: 'Back' });
  setNavigation(editor, next, { action: 'navigate', target: second.id, transition: 'dissolve', duration: 350 });
  setNavigation(editor, back, { action: 'back', transition: 'instant', duration: 0 }); setPrototypeStart(editor, second.id);
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)); expect(serializeGraph(graph)).toBe(before);
  const parsed = parseFigBuffer(new Uint8Array(bytes).buffer), details = parsed.nodeChanges.find(node => node.name === 'Details')!, homePage = parsed.nodeChanges.find(node => node.type === 'CANVAS')!;
  expect(homePage.prototypeStartNodeID).toEqual(details.guid);
  expect(parsed.nodeChanges.find(node => node.name === 'Next')!.prototypeInteractions).toMatchObject([{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType: 'NAVIGATE', transitionNodeID: details.guid, transitionType: 'DISSOLVE', transitionDuration: expect.closeTo(0.35) }] }]);
  expect(parsed.nodeChanges.find(node => node.name === 'Back')!.prototypeInteractions).toMatchObject([{ actions: [{ connectionType: 'BACK' }] }]);
  expect(parsed.nodeChanges.flatMap(node => node.pluginData ?? []).some(entry => entry.pluginID === 'orion.xdesign.prototype-export')).toBe(false);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), named = (name: string) => [...reopened.nodes.values()].find(node => node.name === name)!;
  expect(readNavigation(named('Next'), prototypeResolver(reopened))?.target).toBe(named('Details').id); expect(prototypeStart(reopened, reopened.getPages()[0]!.id)).toBe(named('Details').id);
  // Verify the native interaction without the XDesign metadata fallback.
  named('Next').pluginData = []; expect(readNavigation(named('Next'), prototypeResolver(reopened))?.target).toBe(named('Details').id);
});

it('exports native overlay, Close and Swap actions and frame settings without requiring plugin metadata on reopen', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, home = graph.createNode('FRAME', page, { name: 'Overlay Home' }), dialog = graph.createNode('FRAME', page, { name: 'Modal' }), replacement = graph.createNode('FRAME', page, { name: 'Replacement' });
  setPrototypeOverlay(editor, dialog, { position: 'manual', closeOutside: true, background: { r: 0.25, g: 0.5, b: 0.75, a: 0.5 } });
  setPrototypeInteractions(editor, home, [{ id: 'open', trigger: { type: 'click' }, navigation: { action: 'overlay', target: dialog.id, offset: { x: -12, y: 24 }, transition: 'dissolve', duration: 125 } }]);
  setPrototypeInteractions(editor, dialog, [{ id: 'swap', trigger: { type: 'click' }, navigation: { action: 'swap', target: replacement.id, offset: { x: 4, y: 8 }, transition: 'instant', duration: 0 } }, { id: 'close', trigger: { type: 'key', keyCodes: [65] }, navigation: { action: 'close', transition: 'instant', duration: 0 } }]);
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(serializeGraph(graph)).toBe(before);
  const modal = parsed.nodeChanges.find(node => node.name === 'Modal')!;
  expect(modal).toMatchObject({ overlayPositionType: 'MANUAL', overlayBackgroundInteraction: 'CLOSE_ON_CLICK_OUTSIDE', overlayBackgroundAppearance: { backgroundType: 'SOLID_COLOR', backgroundColor: { r: 0.25, g: 0.5, b: 0.75, a: 0.5 } } });
  expect(parsed.nodeChanges.find(node => node.name === 'Overlay Home')!.prototypeInteractions).toMatchObject([{ actions: [{ navigationType: 'OVERLAY', transitionNodeID: modal.guid, overlayRelativePosition: { x: -12, y: 24 } }] }]);
  expect(modal.prototypeInteractions).toMatchObject([{ actions: [{ navigationType: 'SWAP', overlayRelativePosition: { x: 4, y: 8 } }] }, { actions: [{ connectionType: 'CLOSE' }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), nodes = [...reopened.nodes.values()], named = (name: string) => nodes.find(node => node.name === name)!;
  const ownSettings = readPrototypeOverlay(named('Modal')), ownLinks = readPrototype(named('Modal'), prototypeResolver(reopened));
  nodes.forEach(node => { node.pluginData = []; });
  expect(readPrototypeOverlay(named('Modal'))).toEqual({ ...ownSettings, imported: true });
  expect(readPrototype(named('Modal'), prototypeResolver(reopened)).interactions?.map(({ trigger, navigation }) => ({ trigger, navigation }))).toEqual(ownLinks.interactions?.map(({ trigger, navigation }) => ({ trigger, navigation })));
  expect(readPrototype(named('Overlay Home'), prototypeResolver(reopened)).link).toMatchObject({ action: 'overlay', target: named('Modal').id, offset: { x: -12, y: 24 } });
});
it('exports explicit removals while retaining unsupported imported interactions on other layers', async () => {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId);
  const removed = graph.createNode('RECTANGLE', frame.id, { name: 'Removed' }), preserved = graph.createNode('RECTANGLE', frame.id, { name: 'Preserved' });
  const raw = { prototypeInteractions: [{ id: { sessionID: 8, localID: 9 }, event: { interactionType: 'ON_HOVER' }, actions: [{ connectionType: 'BACK', transitionType: 'MAGIC_MOVE' }] }] };
  removed.source.fig.rawNodeFields = structuredClone(raw); preserved.source.fig.rawNodeFields = structuredClone(raw);
  setNavigation(editor, removed, null);
  const bytes = await exportFigImageCompatible(deserializeGraph(serializeGraph(graph))), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(parsed.nodeChanges.find(node => node.name === 'Removed')!.prototypeInteractions ?? []).toEqual([]);
  expect(parsed.nodeChanges.find(node => node.name === 'Preserved')!.prototypeInteractions).toEqual(raw.prototypeInteractions);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer); expect(readNavigation([...reopened.nodes.values()].find(node => node.name === 'Removed')!)).toBeUndefined();
});
it('refuses dangling authored destinations before emitting a misleading FIG', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, first = graph.createNode('FRAME', page), second = graph.createNode('FRAME', page);
  setNavigation(editor, first, { action: 'navigate', target: second.id, transition: 'instant', duration: 0 }); graph.deleteNode(second.id);
  await expect(exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).rejects.toThrow('missing prototype');
});
it('recovers schema-native legacy connections and standalone flow markers omitted by the engine importer', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, first = graph.createNode('FRAME', page, { name: 'Legacy' });
  first.source.id = '77:1'; first.source.fig.rawNodeFields = { connectionType: 'BACK', interactionType: 'ON_CLICK', transitionInfo: { type: 'DISSOLVE', duration: 0.125 }, prototypeStartingPoint: { name: 'Legacy flow', position: 'a' } };
  const bytes = await exportFigImageCompatible(deserializeGraph(serializeGraph(graph))), reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), node = [...reopened.nodes.values()].find(node => node.name === 'Legacy')!;
  node.pluginData = []; expect(readNavigation(node)).toEqual({ action: 'back', transition: 'dissolve', duration: 125 });
  expect(node.source.fig.rawNodeFields.prototypeStartingPoint).toMatchObject({ name: 'Legacy flow' });
});

it('exports and reimports every supported trigger with native target GUIDs, easing and direction', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, first = graph.createNode('FRAME', page, { name: 'Multi' }), second = graph.createNode('FRAME', page, { name: 'Target' });
  const navigation = { action: 'navigate' as const, target: second.id, transition: 'slide' as const, direction: 'top' as const, duration: 375, easing: [0.25, 0, 0.75, 1] as [number, number, number, number] };
  setPrototypeInteractions(editor, first, [
    { id: 'click', trigger: { type: 'click' }, navigation }, { id: 'delay', trigger: { type: 'delay', delay: 1250 }, navigation },
    { id: 'enter', trigger: { type: 'pointer-enter', delay: 125 }, navigation }, { id: 'leave', trigger: { type: 'pointer-leave' }, navigation },
    { id: 'key', trigger: { type: 'key', keyCodes: [16, 17, 65] }, navigation },
  ]);
  const bytes = await exportFigImageCompatible(deserializeGraph(serializeGraph(graph))), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  const native = parsed.nodeChanges.find(node => node.name === 'Multi')!, target = parsed.nodeChanges.find(node => node.name === 'Target')!;
  const interactions = native.prototypeInteractions as { event: Record<string, unknown>; actions: unknown[] }[];
  expect(interactions.map(interaction => interaction.event)).toEqual([
    { interactionType: 'ON_CLICK' }, { interactionType: 'AFTER_TIMEOUT', transitionTimeout: 1.25 },
    { interactionType: 'MOUSE_ENTER', interactionDuration: 0.125 }, { interactionType: 'MOUSE_LEAVE', interactionDuration: 0 },
    { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [16, 17, 65] } },
  ]);
  for (const interaction of interactions) expect(interaction.actions).toMatchObject([{ transitionNodeID: target.guid, transitionType: 'SLIDE_FROM_TOP', transitionDuration: 0.375, easingType: 'CUSTOM_CUBIC', easingFunction: [0.25, 0, 0.75, 1] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), multi = [...reopened.nodes.values()].find(node => node.name === 'Multi')!, destination = [...reopened.nodes.values()].find(node => node.name === 'Target')!;
  const own = readPrototype(multi, prototypeResolver(reopened)); expect(own.interactions).toHaveLength(5); expect(own.interactions?.every(interaction => interaction.navigation.target === destination.id)).toBe(true);
  multi.pluginData = []; const imported = readPrototype(multi, prototypeResolver(reopened)); expect(imported.issue).toBeUndefined(); expect(imported.interactions?.map(({ trigger, navigation }) => ({ trigger, navigation }))).toEqual(own.interactions?.map(({ trigger, navigation }) => ({ trigger, navigation })));
});

it('round-trips native scrolling, descendant Scroll To, arrival flags and ordered fixed/sticky layers without XDesign metadata', async () => {
  const { setPrototypeScroll, setScrollBehaviour, readPrototypeScroll, readScrollBehaviour } = await import('./prototypeScroll');
  const graph = editor.graph, page = editor.state.currentPageId, home = graph.createNode('FRAME', page, { name: 'Scroll Home' }), other = graph.createNode('FRAME', page, { name: 'Scroll Other' });
  const fixed = graph.createNode('RECTANGLE', home.id, { name: 'Fixed header' }), target = graph.createNode('TEXT', home.id, { name: 'Scroll destination', text: 'Target' }), sticky = graph.createNode('RECTANGLE', home.id, { name: 'Sticky row' });
  setPrototypeScroll(editor, home, { axis: 'both', initial: { x: -10, y: 30 } }); setScrollBehaviour(editor, fixed, 'fixed'); setScrollBehaviour(editor, sticky, 'sticky');
  setPrototypeInteractions(editor, home, [
    { id: 'scroll', trigger: { type: 'click' }, navigation: { action: 'scroll', target: target.id, offset: { x: 4, y: -8 }, transition: 'scroll', duration: 300, easing: 'linear' } },
    { id: 'reset', trigger: { type: 'key', keyCodes: [65] }, navigation: { action: 'navigate', target: other.id, transition: 'instant', duration: 0, resetScroll: true } },
    { id: 'preserve', trigger: { type: 'key', keyCodes: [66] }, navigation: { action: 'overlay', target: other.id, transition: 'instant', duration: 0, preserveScroll: true } },
  ]);
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(serializeGraph(graph)).toBe(before); const native = parsed.nodeChanges.find(node => node.name === 'Scroll Home')!, destination = parsed.nodeChanges.find(node => node.name === 'Scroll destination')!, fixedNative = parsed.nodeChanges.find(node => node.name === 'Fixed header')!;
  expect(native).toMatchObject({ scrollDirection: 'BOTH', scrollOffset: { x: -10, y: 30 }, fixedChildrenDivider: fixedNative.parentIndex!.position });
  expect(native.prototypeInteractions).toMatchObject([{ actions: [{ navigationType: 'SCROLL_TO', transitionNodeID: destination.guid, transitionType: 'SCROLL_ANIMATE', extraScrollOffset: { x: 4, y: -8 } }] }, { actions: [{ transitionResetScrollPosition: true }] }, { actions: [{ transitionPreserveScroll: true }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), named = (name: string) => [...reopened.nodes.values()].find(node => node.name === name)!;
  reopened.nodes.forEach(node => { node.pluginData = []; });
  expect(readPrototypeScroll(named('Scroll Home')).settings).toEqual({ axis: 'both', initial: { x: -10, y: 30 } });
  expect(readPrototype(named('Scroll Home'), prototypeResolver(reopened)).interactions?.map(interaction => interaction.navigation)).toMatchObject([{ action: 'scroll', target: named('Scroll destination').id, offset: { x: 4, y: -8 }, transition: 'scroll' }, { resetScroll: true }, { preserveScroll: true }]);
  expect(reopened.getChildren(named('Scroll Home').id).map(node => node.name)).toEqual(['Scroll destination', 'Sticky row', 'Fixed header']);
  expect(readScrollBehaviour(named('Fixed header'), reopened).behaviour).toBe('fixed'); expect(readScrollBehaviour(named('Sticky row'), reopened).behaviour).toBe('sticky');
  Reflect.deleteProperty(named('Fixed header').source.fig.rawNodeFields, 'scrollBehavior'); expect(readScrollBehaviour(named('Fixed header'), reopened).behaviour).toBe('fixed');
});

it('round-trips true and false native reset-interactive-components transition flags', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, home = graph.createNode('FRAME', page, { name: 'Reset home' }), destination = graph.createNode('FRAME', page, { name: 'Reset destination' });
  setPrototypeInteractions(editor, home, [
    { id: 'reset', trigger: { type: 'click' }, navigation: { action: 'navigate', target: destination.id, transition: 'instant', duration: 0, resetInteractiveComponents: true } },
    { id: 'retain', trigger: { type: 'key', keyCodes: [65] }, navigation: { action: 'back', transition: 'instant', duration: 0, resetInteractiveComponents: false } },
  ]);
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)), parsed = parseFigBuffer(new Uint8Array(bytes).buffer);
  expect(serializeGraph(graph)).toBe(before);
  const native = parsed.nodeChanges.find(node => node.name === 'Reset home')!;
  expect(native.prototypeInteractions).toMatchObject([{ actions: [{ transitionResetInteractiveComponents: true }] }, { actions: [{ transitionResetInteractiveComponents: false }] }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer), imported = [...reopened.nodes.values()].find(node => node.name === 'Reset home')!;
  imported.pluginData = [];
  expect(readPrototype(imported, prototypeResolver(reopened)).interactions?.map(interaction => interaction.navigation.resetInteractiveComponents)).toEqual([true, false]);
});

it.each([true,false])('round-trips raw native video-reset=%s through read, actual FIG export and native-only reopen', async reset=>{
  const graph=editor.graph,page=editor.state.currentPageId,home=graph.createNode('FRAME',page,{name:'Raw video reset home'}),target=graph.createNode('FRAME',page,{name:'Raw video reset target'});target.source.id='97:2';
  const raw={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'INTERNAL_NODE',navigationType:'NAVIGATE',transitionNodeID:{sessionID:97,localID:2},transitionType:'INSTANT_TRANSITION',transitionResetVideoPosition:reset}]}]};home.source.fig.rawNodeFields=structuredClone(raw);
  expect(readNavigation(home,prototypeResolver(graph))).toMatchObject({action:'navigate',target:target.id,resetVideoPosition:reset});const before=serializeGraph(graph),bytes=await exportFigImageCompatible(deserializeGraph(before));expect(serializeGraph(graph)).toBe(before);expect(home.source.fig.rawNodeFields).toEqual(raw);
  const parsed=parseFigBuffer(new Uint8Array(bytes).buffer);expect(parsed.nodeChanges.find(node=>node.name===home.name)!.prototypeInteractions).toMatchObject([{actions:[{transitionResetVideoPosition:reset}]}]);
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer),imported=[...reopened.nodes.values()].find(node=>node.name===home.name)!,destination=[...reopened.nodes.values()].find(node=>node.name===target.name)!;imported.pluginData=[];
  expect(readNavigation(imported,prototypeResolver(reopened))).toMatchObject({action:'navigate',target:destination.id,resetVideoPosition:reset});expect(editor.undo.canUndo).toBe(false);
});

it('clears a stale legacy top-level video reset when an authored false value is exported',async()=>{
  const graph=editor.graph,node=graph.createNode('FRAME',editor.state.currentPageId,{name:'Edited legacy video reset'});node.source.fig.rawNodeFields={connectionType:'BACK',transitionResetVideoPosition:true};
  setNavigation(editor,node,{action:'back',transition:'instant',duration:0,resetVideoPosition:false});const before=serializeGraph(graph),bytes=await exportFigImageCompatible(deserializeGraph(before));expect(serializeGraph(graph)).toBe(before);
  const parsed=parseFigBuffer(new Uint8Array(bytes).buffer),native=parsed.nodeChanges.find(item=>item.name===node.name)!;expect(native.transitionResetVideoPosition).toBeUndefined();expect(native.prototypeInteractions).toMatchObject([{actions:[{transitionResetVideoPosition:false}]}]);
  const reopened=await parseFigWithSlots(new Uint8Array(bytes).buffer),imported=[...reopened.nodes.values()].find(item=>item.name===node.name)!;imported.pluginData=[];expect(readNavigation(imported)?.resetVideoPosition).toBe(false);
});

it('round-trips held/down/up and native video timing fields without plugin fallback', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, held = graph.createNode('FRAME', page, { name: 'Held' }), oneWay = graph.createNode('FRAME', page, { name: 'One way' }), media = graph.createNode('RECTANGLE', held.id, { name: 'Video trigger protocol' });
  const navigation = { action: 'back' as const, transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, held, [{ id: 'hover', trigger: { type: 'hover', delay: 125 }, navigation }, { id: 'press', trigger: { type: 'press' }, navigation }]);
  setPrototypeInteractions(editor, oneWay, [{ id: 'down', trigger: { type: 'pointer-down', delay: 250 }, navigation }, { id: 'up', trigger: { type: 'pointer-up' }, navigation }]);
  // This protocol fixture tests native timing fields; it contains no playable video bytes.
  media.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_MEDIA_HIT', mediaHitTime: 1.25 }, actions: [{ connectionType: 'BACK' }] }, { event: { interactionType: 'ON_MEDIA_END' }, actions: [{ connectionType: 'BACK' }] }] };
  const before = serializeGraph(graph), bytes = await exportFigImageCompatible(deserializeGraph(before)); expect(serializeGraph(graph)).toBe(before);
  const parsed = parseFigBuffer(new Uint8Array(bytes).buffer); expect(parsed.nodeChanges.find(node => node.name === 'Held')!.prototypeInteractions).toMatchObject([{ event: { interactionType: 'ON_HOVER', interactionMaintained: true, interactionDuration: 0.125 } }, { event: { interactionType: 'ON_PRESS', interactionMaintained: true, interactionDuration: 0 } }]);
  const reopened = await parseFigWithSlots(new Uint8Array(bytes).buffer); reopened.nodes.forEach(node => { node.pluginData = []; }); const named = (name: string) => [...reopened.nodes.values()].find(node => node.name === name)!;
  expect(readPrototype(named('Held')).interactions?.map(({ trigger }) => trigger)).toEqual([{ type: 'hover', delay: 125 }, { type: 'press' }]); expect(readPrototype(named('One way')).interactions?.map(({ trigger }) => trigger)).toEqual([{ type: 'pointer-down', delay: 250 }, { type: 'pointer-up' }]); expect(readPrototype(named('Video trigger protocol')).interactions?.map(({ trigger }) => trigger)).toEqual([{ type: 'media-hit', time: 1.25 }, { type: 'media-end' }]);
});
