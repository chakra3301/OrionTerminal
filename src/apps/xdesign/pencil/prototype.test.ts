import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { deserializeGraph, serializeGraph } from './document';
import { setPrototypeInteractions, validPrototypeKeys, navigatePrototype, prototypeResolver, prototypeScreens, prototypeStart, readNavigation, readPrototype, setNavigation, setPrototypeStart, prototypeActionMediaTargets, type DesignNavigation } from './prototype';
let editor: Editor;
beforeEach(() => { editor = createEditor(); });
afterEach(() => editor.dispose());
const link = (target: string): DesignNavigation => ({ action: 'navigate', target, transition: 'dissolve', duration: 250 });
const videoFill = { type: 'VIDEO' as const, visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 } };
const mediaAction = (target: string, mediaAction: 'play' | 'pause' | 'toggle'): DesignNavigation => ({ action: 'media', mediaAction, target, transition: 'instant', duration: 0 });
describe('native design prototypes', () => {
  it.each(['play', 'pause', 'toggle'] as const)('authors explicit targeted video %s with exact graph Undo and snapshot playback metadata', operation => {
    const graph=editor.graph, screen=graph.createNode('FRAME',editor.state.currentPageId), video=graph.createNode('RECTANGLE',screen.id,{name:'Target video',fills:[videoFill]}), button=graph.createNode('RECTANGLE',screen.id);
    editor.updateNodeWithUndo(button.id,{pluginData:[{pluginId:'vendor',key:'keep',value:'original'}]},'Author media fixture');editor.undo.clear();
    const before=serializeGraph(graph), action=mediaAction(video.id,operation);
    setNavigation(editor,button,action);const authored=serializeGraph(graph);
    expect(readNavigation(button)).toEqual(action);expect(video.pluginData).toEqual([]);
    const restored=deserializeGraph(authored);expect(readNavigation(restored.getNode(button.id)!)).toEqual(action);
    editor.undoAction();expect(serializeGraph(graph)).toBe(before);editor.redoAction();expect(serializeGraph(graph)).toBe(authored);
  });
  it.each([['PLAY','play'],['PAUSE','pause'],['TOGGLE_PLAY_PAUSE','toggle']] as const)('reads native targeted %s through source GUID resolution without mutating authored graph', (native,operation) => {
    const graph=editor.graph, frame=graph.createNode('FRAME',editor.state.currentPageId), video=graph.createNode('RECTANGLE',frame.id,{fills:[videoFill]}), button=graph.createNode('RECTANGLE',frame.id);
    video.source.id='9:17';button.source.fig.rawNodeFields={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:native,transitionNodeID:{sessionID:9,localID:17}}]}]};
    const before=serializeGraph(graph), undo=editor.undo.canUndo;
    expect(readNavigation(button,prototypeResolver(graph))).toEqual(mediaAction(video.id,operation));expect(serializeGraph(graph)).toBe(before);expect(editor.undo.canUndo).toBe(undo);
  });
  it('preserves unsupported native media enums, missing targets and extra seek/rate parameters as diagnostics', () => {
    const graph=editor.graph, frame=graph.createNode('FRAME',editor.state.currentPageId), node=graph.createNode('RECTANGLE',frame.id);
    const base={connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'PLAY',transitionNodeID:{sessionID:9,localID:17}};
    for(const patch of [{mediaAction:'MUTE'},{mediaAction:'SKIP_TO'},{mediaAction:'SET_PLAYBACK_RATE'},{mediaAction:'toString'},{mediaAction:'constructor'},{mediaAction:'__proto__'},{mediaAction:undefined},{transitionNodeID:undefined},{transitionNodeID:{sessionID:-1,localID:17}},{mediaSkipToTime:0},{mediaSkipByAmount:0},{mediaPlaybackRate:1},{transitionDuration:0.3}]) {
      node.source.fig.rawNodeFields={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{...base,...patch}]}]};const before=serializeGraph(graph);
      expect(readPrototype(node).issue).toContain('preserved');expect(readPrototype(node).interactions).toBeUndefined();expect(serializeGraph(graph)).toBe(before);
    }
  });
  it('validates video scope at sequential navigation and overlay steps, including conditional branch context', () => {
    const graph=editor.graph, page=editor.state.currentPageId, first=graph.createNode('FRAME',page), second=graph.createNode('FRAME',page), overlay=graph.createNode('FRAME',page), button=graph.createNode('RECTANGLE',first.id);
    const a=graph.createNode('RECTANGLE',first.id,{fills:[videoFill]}), b=graph.createNode('RECTANGLE',second.id,{fills:[videoFill]}), c=graph.createNode('RECTANGLE',overlay.id,{fills:[videoFill]});
    expect(()=>setNavigation(editor,button,mediaAction(b.id,'play'))).toThrow('visible video');
    const sequence:DesignNavigation={action:'sequence',transition:'instant',duration:0,actions:[mediaAction(a.id,'pause'),link(second.id),mediaAction(b.id,'play'),{action:'overlay',target:overlay.id,transition:'instant',duration:0},mediaAction(c.id,'toggle')]};
    setNavigation(editor,button,sequence);expect(readNavigation(button)).toEqual(sequence);
    expect(()=>setNavigation(editor,button,{...sequence,actions:[link(second.id),mediaAction(a.id,'play')]})).toThrow('visible video');
    const conditional:DesignNavigation={action:'conditional',transition:'instant',duration:0,branches:[{condition:{type:'literal',value:true},actions:[link(second.id),mediaAction(b.id,'toggle')]},{actions:[mediaAction(a.id,'pause')]}]};
    setNavigation(editor,button,conditional);expect(readNavigation(button)).toEqual(conditional);
    expect(()=>setNavigation(editor,button,{...conditional,branches:[{actions:[mediaAction(b.id,'play')]}]})).toThrow('visible video');
  });
  it('admits a video-filled screen itself and rejects hidden, nonvideo, unresolved and malformed local video actions atomically', () => {
    const graph=editor.graph, page=editor.state.currentPageId, frame=graph.createNode('FRAME',page,{fills:[videoFill]}), button=graph.createNode('RECTANGLE',frame.id), hidden=graph.createNode('RECTANGLE',frame.id,{visible:false,fills:[videoFill]}), nonvideo=graph.createNode('RECTANGLE',frame.id);
    setNavigation(editor,button,mediaAction(frame.id,'play'));const before=serializeGraph(graph), action=readNavigation(button);
    for(const candidate of [mediaAction(hidden.id,'play'),mediaAction(nonvideo.id,'play'),{...mediaAction(frame.id,'play'),unresolved:true},{...mediaAction(frame.id,'play'),target:undefined},{...mediaAction(frame.id,'play'),duration:1},{...mediaAction(frame.id,'play'),mediaAction:'mute'},{...mediaAction(frame.id,'play'),resetVideoPosition:false}]) {
      expect(()=>setNavigation(editor,button,candidate as DesignNavigation)).toThrow();expect(readNavigation(button)).toEqual(action);expect(serializeGraph(graph)).toBe(before);
    }
  });
  it('bounds aggregate video-target traversal across unknown sequential contexts without changing the graph', () => {
    const graph=editor.graph, page=editor.state.currentPageId, first=graph.createNode('FRAME',page), second=graph.createNode('FRAME',page), example=graph.createNode('RECTANGLE',first.id), getChildren=graph.getChildren.bind(graph);
    const children=(prefix:string,parentId:string)=>Array.from({length:10000},(_,index)=>({...example,id:`${prefix}-${index}`,parentId,childIds:[]}));
    const a=children('a',first.id),b=children('b',second.id),before=serializeGraph(graph);
    const spy=vi.spyOn(graph,'getChildren').mockImplementation(id=>id===first.id?a:id===second.id?b:getChildren(id));
    try {expect(()=>prototypeActionMediaTargets(graph,null,[first,second])).toThrow('Video targets support at most 20,000 layers');}
    finally {spy.mockRestore();}
    expect(serializeGraph(graph)).toBe(before);
  });
  it('enumerates the exact nested video occurrence subtree and prunes hidden context roots and branches', () => {
    const graph=editor.graph, outer=graph.createNode('FRAME',editor.state.currentPageId), sibling=graph.createNode('RECTANGLE',outer.id,{name:'Outside sibling video',fills:[videoFill]}), nested=graph.createNode('FRAME',outer.id,{name:'Nested video screen',fills:[videoFill]}), inside=graph.createNode('RECTANGLE',nested.id,{name:'Nested child video',fills:[videoFill]});
    const hidden=graph.createNode('FRAME',nested.id,{visible:false}), hiddenVideo=graph.createNode('RECTANGLE',hidden.id,{fills:[videoFill]});
    const before=serializeGraph(graph);
    expect(prototypeActionMediaTargets(graph,nested,[outer]).map(node=>node.id)).toEqual([nested.id,inside.id]);
    expect(prototypeActionMediaTargets(graph,hidden,[outer])).toEqual([]);expect(prototypeActionMediaTargets(graph,nested,[outer]).some(node=>node.id===sibling.id||node.id===hiddenVideo.id)).toBe(false);
    expect(serializeGraph(graph)).toBe(before);
    nested.visible=false;expect(prototypeActionMediaTargets(graph,nested,[outer])).toEqual([]);
    nested.visible=true;nested.internalOnly=true;expect(prototypeActionMediaTargets(graph,nested,[outer])).toEqual([]);
  });
  it('canonicalizes inherited component video aliases within the actor instance while preserving explicit actual choices and the master', () => {
    const graph=editor.graph, page=editor.state.currentPageId, main=graph.createNode('COMPONENT',page), templateVideo=graph.createNode('RECTANGLE',main.id,{fills:[videoFill]}), templateButton=graph.createNode('RECTANGLE',main.id);
    setNavigation(editor,templateButton,mediaAction(templateVideo.id,'play'));
    const screen=graph.createNode('FRAME',page), first=graph.createInstance(main.id,screen.id)!, second=graph.createInstance(main.id,screen.id)!;
    const child=(instance:typeof first,id:string)=>graph.getChildren(instance.id).find(node=>node.componentId===id)!;
    const button=child(first,templateButton.id), ownVideo=child(first,templateVideo.id), otherVideo=child(second,templateVideo.id), otherButton=child(second,templateButton.id), master=structuredClone(templateButton.pluginData), sibling=structuredClone(otherButton.pluginData);
    expect(readNavigation(button)).toEqual(mediaAction(templateVideo.id,'play'));
    setPrototypeInteractions(editor,button,[{id:'click',trigger:{type:'click'},navigation:mediaAction(templateVideo.id,'pause')}]);
    expect(readNavigation(button)).toEqual(mediaAction(ownVideo.id,'pause'));expect(templateButton.pluginData).toEqual(master);expect(otherButton.pluginData).toEqual(sibling);
    setNavigation(editor,button,mediaAction(otherVideo.id,'toggle'));expect(readNavigation(button)).toEqual(mediaAction(otherVideo.id,'toggle'));expect(templateButton.pluginData).toEqual(master);
    editor.undoAction();expect(readNavigation(button)).toEqual(mediaAction(ownVideo.id,'pause'));editor.redoAction();expect(readNavigation(button)).toEqual(mediaAction(otherVideo.id,'toggle'));
  });
  it('recovers native instance prototype overrides by exact definition path without mutating either occurrence or the master', () => {
    const graph=editor.graph, page=editor.state.currentPageId, main=graph.createNode('COMPONENT',page), video=graph.createNode('RECTANGLE',main.id,{fills:[videoFill]}), button=graph.createNode('RECTANGLE',main.id);
    video.source.id='211:1';button.source.id='211:2';
    setNavigation(editor,button,mediaAction(video.id,'play'));
    button.source.fig.rawNodeFields={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'PLAY',transitionNodeID:{sessionID:211,localID:1}}]}]};
    const screen=graph.createNode('FRAME',page), first=graph.createInstance(main.id,screen.id)!, second=graph.createInstance(main.id,screen.id)!;
    const child=(instance:typeof first,id:string)=>graph.getChildren(instance.id).find(node=>node.componentId===id)!;
    first.source.fig.symbolOverrides=[{guidPath:{guids:[{sessionID:211,localID:2}]},prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'UPDATE_MEDIA_RUNTIME',mediaAction:'PAUSE',transitionNodeID:{sessionID:211,localID:1}}]}]}];
    const before=serializeGraph(graph), own=child(first,video.id), actor=child(first,button.id), peer=child(second,button.id), resolve=prototypeResolver(graph);
    expect(readNavigation(actor,resolve)).toEqual(mediaAction(own.id,'pause'));
    expect(readNavigation(peer,resolve)).toEqual(mediaAction(child(second,video.id).id,'play'));
    expect(serializeGraph(graph)).toBe(before);
    for(const node of graph.nodes.values())node.pluginData=[];
    const nativeBefore=serializeGraph(graph);
    expect(readNavigation(actor,prototypeResolver(graph))).toEqual(mediaAction(own.id,'pause'));
    expect(readNavigation(peer,prototypeResolver(graph))).toEqual(mediaAction(child(second,video.id).id,'play'));
    expect(serializeGraph(graph)).toBe(nativeBefore);
    setNavigation(editor,actor,mediaAction(own.id,'toggle'));
    expect(readNavigation(actor,prototypeResolver(graph))).toEqual(mediaAction(own.id,'toggle'));
    expect(readNavigation(peer,prototypeResolver(graph))).toEqual(mediaAction(child(second,video.id).id,'play'));
  });
  it('resolves original GUID identities inside the current private variant graph without changing source or clearing explicit unresolved targets', () => {
    const graph=editor.graph,page=editor.state.currentPageId;
    const first=graph.createNode('COMPONENT',page),second=graph.createNode('COMPONENT',page);
    for(const component of [first,second]) {
      const video=graph.createNode('RECTANGLE',component.id,{fills:[videoFill]}),button=graph.createNode('RECTANGLE',component.id);
      video.source.id=component===first?'212:1':'212:2';
      setNavigation(editor,button,mediaAction(video.id,'toggle'));
    }
    const screen=graph.createNode('FRAME',page),instance=graph.createInstance(first.id,screen.id)!;
    const before=serializeGraph(graph),privateGraph=deserializeGraph(before);
    privateGraph.swapInstanceComponent(instance.id,second.id);
    const children=privateGraph.getChildren(instance.id),video=children.find(node=>node.fills.some(fill=>fill.type==='VIDEO'))!,button=children.find(node=>!node.fills.some(fill=>fill.type==='VIDEO'))!;
    const privateBefore=serializeGraph(privateGraph),resolve=prototypeResolver(graph,[],privateGraph);
    expect(resolve('212:2')).toBe(graph.getChildren(second.id).find(node=>node.fills.some(fill=>fill.type==='VIDEO'))!.id);
    expect(readNavigation(button,resolve)).toEqual(mediaAction(video.id,'toggle'));
    expect(serializeGraph(graph)).toBe(before);expect(serializeGraph(privateGraph)).toBe(privateBefore);
    privateGraph.updateNode(button.id,{pluginData:[{pluginId:'orion.xdesign',key:'prototypeLink',value:JSON.stringify({...mediaAction(video.id,'pause'),unresolved:true})}]});
    const unresolvedBefore=serializeGraph(privateGraph);
    expect(readNavigation(button,resolve)).toEqual({...mediaAction(video.id,'pause'),unresolved:true});
    expect(serializeGraph(privateGraph)).toBe(unresolvedBefore);expect(serializeGraph(graph)).toBe(before);
  });
  it('rejects an ambiguous inherited alias outside both instances without guessing by name', () => {
    const graph=editor.graph, page=editor.state.currentPageId, main=graph.createNode('COMPONENT',page), video=graph.createNode('RECTANGLE',main.id,{name:'Same video',fills:[videoFill]}), screen=graph.createNode('FRAME',page), actor=graph.createNode('RECTANGLE',screen.id);
    graph.createInstance(main.id,screen.id);graph.createInstance(main.id,screen.id);const before=serializeGraph(graph);
    expect(()=>setNavigation(editor,actor,mediaAction(video.id,'play'))).toThrow('ambiguous');expect(serializeGraph(graph)).toBe(before);
  });
  it.each([true, false, undefined])('authors and roundtrips a distinct URL action with newTab=%s through native history', newTab => {
    const graph = editor.graph, page = editor.state.currentPageId, screen = graph.createNode('FRAME', page), node = graph.createNode('RECTANGLE', screen.id);
    editor.updateNodeWithUndo(node.id, { pluginData: [{ pluginId: 'vendor', key: 'retain', value: 'exact' }] }, 'Author fixture metadata'); editor.undo.clear();
    expect(node.source.editedFields).toEqual(['pluginData']); expect(editor.undo.canUndo).toBe(false);
    const url = 'HTTPS://user:pass@Example.com:443/a%20b?q=one#two';
    const action: DesignNavigation = { action: 'open-url', url, ...(newTab !== undefined ? { newTab } : {}), transition: 'instant', duration: 0 };
    const before = serializeGraph(graph);
    setNavigation(editor, node, action);
    expect(readNavigation(node)).toEqual(action); expect(readNavigation(node)?.target).toBeUndefined();
    expect(readNavigation(deserializeGraph(serializeGraph(graph)).getNode(node.id)!)).toEqual(action);
    expect(node.pluginData.find(entry => entry.pluginId === 'vendor')).toEqual({ pluginId: 'vendor', key: 'retain', value: 'exact' });
    editor.undoAction(); expect(serializeGraph(graph)).toBe(before); editor.redoAction(); expect(readNavigation(node)).toEqual(action);
  });
  it('preserves URL protocols and ordered nested conditional actions without resolving URLs as layer identities', () => {
    const graph = editor.graph, screen = graph.createNode('FRAME', editor.state.currentPageId), node = graph.createNode('RECTANGLE', screen.id);
    const urls = ['http://example.com/a', 'https://example.com/b?x=%2F', 'mailto:hello@example.com?subject=Hello%20there', 'tel:+1-555-0100'];
    const actions: DesignNavigation[] = urls.map((url, index) => ({ action: 'open-url', url, newTab: index % 2 === 0, transition: 'instant', duration: 0 }));
    const tree: DesignNavigation = { action: 'sequence', transition: 'instant', duration: 0, actions: [actions[0]!, { action: 'conditional', transition: 'instant', duration: 0, branches: [{ condition: { type: 'literal', value: true }, actions: actions.slice(1) }, { actions: [] }] }, { action: 'back', transition: 'instant', duration: 0 }] };
    setPrototypeInteractions(editor, node, [{ id: 'links', trigger: { type: 'click' }, navigation: tree }]);
    expect(readPrototype(node, id => `resolved-${id}`).interactions?.[0]?.navigation).toEqual(tree);
    expect(readPrototype(deserializeGraph(serializeGraph(graph)).getNode(node.id)!).interactions?.[0]?.navigation).toEqual(tree);
  });
  it('rejects unsafe or oversized URL metadata atomically while preserving the preceding action and history', () => {
    const graph = editor.graph, screen = graph.createNode('FRAME', editor.state.currentPageId), node = graph.createNode('RECTANGLE', screen.id);
    setNavigation(editor, node, link(screen.id));
    const before = serializeGraph(graph), canUndo = editor.undo.canUndo, canRedo = editor.undo.canRedo;
    const valid: DesignNavigation = { action: 'open-url', url: 'https://example.com/', newTab: false, transition: 'instant', duration: 0 };
    const invalid: unknown[] = ['javascript:alert(1)', 'data:text/plain,hello', '/relative', '//example.com', 'https://', ' https://example.com', 'https://example.com ', 'https://example.com/\nnext', 'https:\\example.com', '', 123, 'https://example.com/' + 'a'.repeat(32768)];
    for (const url of invalid) expect(() => setNavigation(editor, node, { ...valid, url } as DesignNavigation)).toThrow();
    for (const patch of [{ newTab: 'false' }, { newTab: null }, { target: screen.id }, { transition: 'dissolve' }, { duration: 1 }, { resetVideoPosition: true }]) expect(() => setNavigation(editor, node, { ...valid, ...patch } as DesignNavigation)).toThrow();
    expect(serializeGraph(graph)).toBe(before); expect(editor.undo.canUndo).toBe(canUndo); expect(editor.undo.canRedo).toBe(canRedo);
  });
  it('preserves native variable/CMS and malformed URL actions as unsupported instead of partially playing a sequence', () => {
    const graph = editor.graph, screen = graph.createNode('FRAME', editor.state.currentPageId), node = graph.createNode('RECTANGLE', screen.id);
    for (const patch of [{ linkParam: { dataType: 'STRING' } }, { cmsTarget: {} }, { openUrlInNewTab: 'false' }, { connectionURL: 'file:///tmp/example' }]) {
      const raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK' }, { connectionType: 'URL', connectionURL: 'https://example.com/', ...patch }] }] };
      node.source.fig.rawNodeFields = structuredClone(raw); const before = serializeGraph(graph);
      expect(readPrototype(node)).toMatchObject({ imported: true, issue: expect.stringContaining('preserved') }); expect(readPrototype(node).interactions).toBeUndefined();
      expect(serializeGraph(graph)).toBe(before); expect(node.source.fig.rawNodeFields).toEqual(raw);
    }
  });
  it('imports legacy and conditional native URLs independently of destination GUIDs and preserves their raw fields', () => {
    const graph = editor.graph, screen = graph.createNode('FRAME', editor.state.currentPageId), node = graph.createNode('RECTANGLE', screen.id);
    const url = 'https://example.com/7:42?next=%2Fscreen';
    const legacy = { connectionType: 'URL', connectionURL: url, transitionNodeID: { sessionID: 7, localID: 42 } };
    node.source.fig.rawNodeFields = structuredClone(legacy); let before = serializeGraph(graph);
    expect(readNavigation(node, id => `resolved-${id}`)).toEqual({ action: 'open-url', url, transition: 'instant', duration: 0 }); expect(serializeGraph(graph)).toBe(before);
    const raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'CONDITIONAL', conditionalActions: [{ actions: [{ ...legacy, openUrlInNewTab: false }] }] }] }] };
    node.source.fig.rawNodeFields = structuredClone(raw); before = serializeGraph(graph);
    expect(readPrototype(node).interactions?.[0]?.navigation).toEqual({ action: 'conditional', transition: 'instant', duration: 0, branches: [{ actions: [{ action: 'open-url', url, newTab: false, transition: 'instant', duration: 0 }] }] });
    expect(node.source.fig.rawNodeFields).toEqual(raw); expect(serializeGraph(graph)).toBe(before); expect(editor.undo.canUndo).toBe(false);
  });
  it('distinguishes authored local identities from colliding imported source GUIDs', () => {
    const graph = editor.graph, page = editor.state.currentPageId, first = graph.createNode('FRAME', page), second = graph.createNode('FRAME', page), unrelated = graph.createNode('FRAME', page);
    unrelated.source.id = second.id;
    setNavigation(editor, first, link(second.id)); setPrototypeStart(editor, second.id);
    expect(readNavigation(first, prototypeResolver(graph))?.target).toBe(second.id); expect(prototypeStart(graph, page)).toBe(second.id);
    first.pluginData = [{ pluginId: 'orion.xdesign', key: 'prototypeLink', value: JSON.stringify({ ...link(second.id), targetFormat: 'fig' }) }];
    expect(readNavigation(first, prototypeResolver(graph))?.target).toBe(unrelated.id);
  });
  it('reads native FIG click actions, legacy links, Back and starting screens by source identity', () => {
    const graph = editor.graph, page = editor.state.currentPageId;
    const first = graph.createNode('FRAME', page), second = graph.createNode('FRAME', page);
    second.source.id = '7:42';
    const hotspot = graph.createNode('RECTANGLE', first.id);
    hotspot.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 7, localID: 42 }, transitionType: 'DISSOLVE', transitionDuration: 0.25 }] }] };
    expect(readNavigation(hotspot, prototypeResolver(graph))).toEqual(link(second.id));
    hotspot.source.fig.rawNodeFields = { connectionType: 'BACK', transitionInfo: { type: 'INSTANT_TRANSITION', duration: 0 } };
    expect(readNavigation(hotspot)).toEqual({ action: 'back', transition: 'instant', duration: 0 });
    graph.getNode(page)!.source.fig.rawNodeFields = { prototypeStartNodeID: { sessionID: 7, localID: 42 } };
    expect(prototypeStart(graph, page)).toBe(second.id);
  });
  it('imports both explicit native interactive-component reset values without changing source fields', () => {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId), hotspot = graph.createNode('RECTANGLE', frame.id);
    const raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionResetInteractiveComponents: true }] }, { event: { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [65] } }, actions: [{ connectionType: 'BACK', transitionResetInteractiveComponents: false }] }] };
    hotspot.source.fig.rawNodeFields = structuredClone(raw);
    expect(readPrototype(hotspot).interactions?.map(interaction => interaction.navigation.resetInteractiveComponents)).toEqual([true, false]);
    expect(hotspot.source.fig.rawNodeFields).toEqual(raw);
  });
  it('reads explicit native video-reset true and false without normalizing away false or mutating source', () => {
    const graph=editor.graph,screen=graph.createNode('FRAME',editor.state.currentPageId),hotspot=graph.createNode('RECTANGLE',screen.id);
    const raw={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{connectionType:'BACK',transitionResetVideoPosition:true}]},{event:{interactionType:'ON_KEY_DOWN',keyTrigger:{triggerDevice:'KEYBOARD',keyCodes:[65]}},actions:[{connectionType:'BACK',transitionResetVideoPosition:false}]}]};
    hotspot.source.fig.rawNodeFields=structuredClone(raw);const before=serializeGraph(graph);
    expect(readPrototype(hotspot).interactions?.map(item=>item.navigation.resetVideoPosition)).toEqual([true,false]);expect(hotspot.source.fig.rawNodeFields).toEqual(raw);expect(serializeGraph(graph)).toBe(before);expect(editor.undo.canUndo).toBe(false);
  });
  it('preserves authored video-reset route flags through save and Undo/Redo while keeping unrelated metadata', () => {
    const graph=editor.graph,screen=graph.createNode('FRAME',editor.state.currentPageId),node=graph.createNode('RECTANGLE',screen.id,{pluginData:[{pluginId:'vendor',key:'retain',value:'exact'}]});
    const reset={...link(screen.id),resetVideoPosition:true};setNavigation(editor,node,reset);expect(readNavigation(node)).toEqual(reset);
    setNavigation(editor,node,{...reset,resetVideoPosition:false});expect(readNavigation(deserializeGraph(serializeGraph(graph)).getNode(node.id)!)).toEqual({...reset,resetVideoPosition:false});
    editor.undoAction();expect(readNavigation(node)).toEqual(reset);editor.redoAction();expect(readNavigation(node)).toEqual({...reset,resetVideoPosition:false});expect(node.pluginData.find(item=>item.pluginId==='vendor')).toEqual({pluginId:'vendor',key:'retain',value:'exact'});
  });
  it('retains false video-reset on scroll, rejects true or malformed values and leaves prior authored actions intact', () => {
    const graph=editor.graph,screen=graph.createNode('FRAME',editor.state.currentPageId),target=graph.createNode('RECTANGLE',screen.id),node=graph.createNode('RECTANGLE',screen.id);target.source.id='91:4';
    const raw={connectionType:'INTERNAL_NODE',navigationType:'SCROLL_TO',transitionNodeID:{sessionID:91,localID:4},transitionType:'INSTANT_TRANSITION'};
    node.source.fig.rawNodeFields={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{...raw,transitionResetVideoPosition:false}]}]};expect(readPrototype(node).interactions?.[0]?.navigation).toMatchObject({action:'scroll',resetVideoPosition:false});
    for(const invalid of [true,'true',0,null]){node.source.fig.rawNodeFields={prototypeInteractions:[{event:{interactionType:'ON_CLICK'},actions:[{...raw,transitionResetVideoPosition:invalid}]}]};expect(readPrototype(node).issue).toContain('cannot play');}
    node.source.fig.rawNodeFields={};setNavigation(editor,node,{...link(screen.id),resetVideoPosition:false});const before=serializeGraph(graph);
    for(const invalid of [{action:'scroll',target:target.id,transition:'instant',duration:0,resetVideoPosition:true},{...link(screen.id),resetVideoPosition:'true'},{action:'set-variable',variable:'missing',value:{type:'literal',value:true},transition:'instant',duration:0,resetVideoPosition:true}])expect(()=>setNavigation(editor,node,invalid as DesignNavigation)).toThrow();
    expect(serializeGraph(graph)).toBe(before);
  });
  it('normalizes a false reset on a local scroll action but refuses true or malformed unsupported flags', () => {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId), hotspot = graph.createNode('RECTANGLE', frame.id), target = graph.createNode('RECTANGLE', frame.id); target.source.id = '1:2';
    const action = { connectionType: 'INTERNAL_NODE', navigationType: 'SCROLL_TO', transitionNodeID: { sessionID: 1, localID: 2 }, transitionType: 'INSTANT_TRANSITION' };
    hotspot.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ ...action, transitionResetInteractiveComponents: false }] }] };
    expect(readPrototype(hotspot)).toMatchObject({ interactions: [{ navigation: { action: 'scroll', resetInteractiveComponents: false } }] });
    hotspot.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ ...action, transitionResetInteractiveComponents: true }] }] };
    expect(readPrototype(hotspot).issue).toContain('cannot play');
    hotspot.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionResetInteractiveComponents: 'true' }] }] };
    expect(readPrototype(hotspot).issue).toContain('cannot play'); expect(graph.getNode(target.id)).toBe(target);
  });
  it('makes explicit removal authoritative over preserved imports through reopen and undo', () => {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId);
    const hotspot = graph.createNode('RECTANGLE', frame.id), raw = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK' }] }] };
    hotspot.source.fig.rawNodeFields = structuredClone(raw);
    expect(readNavigation(hotspot)?.action).toBe('back');
    setNavigation(editor, hotspot, null); expect(readNavigation(hotspot)).toBeUndefined();
    expect(readNavigation(deserializeGraph(serializeGraph(graph)).getNode(hotspot.id)!)).toBeUndefined();
    expect(hotspot.source.fig.rawNodeFields).toEqual(raw);
    editor.undoAction(); expect(readNavigation(hotspot)?.action).toBe('back'); editor.redoAction(); expect(readNavigation(hotspot)).toBeUndefined();
  });
  it('identifies unsupported interactions without guessing a supported action', () => {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId);
    for (const patch of [{ connectionType: 'URL' }, { navigationType: 'OVERLAY' }, { transitionShouldSmartAnimate: true }, { transitionType: 'MAGIC_MOVE' }, { transitionResetScrollPosition: true }, { transitionDuration: 11 }, { transitionDuration: NaN }]) {
      node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', ...patch }] }] };
      expect(readPrototype(node)).toMatchObject({ imported: true, issue: expect.stringContaining('cannot play') }); expect(readNavigation(node)).toBeUndefined();
    }
    for (const trigger of ['ON_VOICE', 'AFTER_TIMEOUT', 'ON_KEY_DOWN']) {
      node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: trigger }, actions: [{ connectionType: 'BACK' }] }] };
      expect(readPrototype(node).issue).toContain('trigger');
    }
    node.source.fig.rawNodeFields = { prototypeInteractions: Array.from({ length: 129 }, () => ({ isDeleted: true })) }; expect(readPrototype(node).issue).toContain('excessive');
    node.source.fig.rawNodeFields = { prototypeInteractions: [{ isDeleted: true }] }; expect(readPrototype(node)).toEqual({});
  });
  it('finds section screens, skips hidden subtrees, and never treats nested frames as screens', () => {
    const graph = editor.graph, page = editor.state.currentPageId;
    const screen = graph.createNode('FRAME', page);
    graph.createNode('FRAME', screen.id);
    const section = graph.createNode('SECTION', page), second = graph.createNode('FRAME', section.id);
    const hidden = graph.createNode('SECTION', page, { visible: false }); graph.createNode('FRAME', hidden.id);
    expect(prototypeScreens(graph, page).map(node => node.id)).toEqual([screen.id, second.id]);
  });
  it('preserves unrelated metadata and layer identity through save, reopen, undo and redo', () => {
    const graph = editor.graph, page = editor.state.currentPageId;
    const first = graph.createNode('FRAME', page), second = graph.createNode('FRAME', page);
    const hotspot = graph.createNode('TEXT', first.id, { pluginData: [{ pluginId: 'other', key: 'keep', value: 'yes' }] });
    setNavigation(editor, hotspot, link(second.id)); setPrototypeStart(editor, second.id);
    const reopened = deserializeGraph(serializeGraph(graph));
    expect(readNavigation(reopened.getNode(hotspot.id)!)).toEqual(link(second.id)); expect(prototypeStart(reopened, page)).toBe(second.id);
    editor.undoAction(); expect(prototypeStart(graph, page)).toBe(first.id);
    editor.undoAction(); expect(readNavigation(hotspot)).toBeUndefined(); expect(graph.getNode(hotspot.id)).toBe(hotspot); expect(hotspot.pluginData).toEqual([{ pluginId: 'other', key: 'keep', value: 'yes' }]);
    editor.redoAction(); expect(readNavigation(hotspot)).toEqual(link(second.id));
    graph.deleteNode(second.id); expect(prototypeStart(graph, page)).toBe(first.id);
  });
  it('refuses invalid targets, invalid metadata and protected ancestors', () => {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId), child = graph.createNode('RECTANGLE', frame.id);
    expect(() => setNavigation(editor, child, link('missing'))).toThrow('screen');
    expect(() => setNavigation(editor, child, { ...link(frame.id), duration: NaN })).toThrow('valid');
    graph.updateNode(frame.id, { locked: true }); expect(() => setNavigation(editor, child, link(frame.id))).toThrow('Unlock');
    expect(readNavigation({ ...child, pluginData: [{ pluginId: 'orion.xdesign', key: 'prototypeLink', value: '{bad' }] })).toBeUndefined();
    expect(readNavigation({ ...child, pluginData: [{ pluginId: 'orion.xdesign', key: 'prototypeLink', value: JSON.stringify({ action: 'open-url', target: 'https://example.com', transition: 'instant', duration: 0 }) }] })).toBeUndefined();
  });
  it('bounds navigation history, ignores same-screen links and handles back or missing screens', () => {
    const screens = new Set(['a', 'b']), history = Array.from({ length: 200 }, () => 'a');
    const next = navigatePrototype('a', history, link('b'), screens); expect(next.history).toHaveLength(128); expect(next.screen).toBe('b');
    expect(navigatePrototype('b', ['a'], { action: 'back', transition: 'instant', duration: 0 }, screens)).toEqual({ screen: 'a', history: [] });
    expect(navigatePrototype('a', [], { action: 'back', transition: 'instant', duration: 0 }, screens)).toEqual({ screen: 'a', history: [] });
    expect(navigatePrototype('a', [], link('a'), screens).history).toEqual([]);
    expect(() => navigatePrototype('a', [], link('removed'), screens)).toThrow('removed');
  });
});

it('persists multiple distinct triggers, timing, directions and easing through reopen and undo', () => {
  const graph = editor.graph, page = editor.state.currentPageId, first = graph.createNode('FRAME', page), second = graph.createNode('FRAME', page);
  const interactions = [
    { id: 'click', trigger: { type: 'click' as const }, navigation: link(second.id) },
    { id: 'enter', trigger: { type: 'pointer-enter' as const, delay: 125 }, navigation: { ...link(second.id), transition: 'slide' as const, direction: 'left' as const, easing: [0.25, 0, 0.75, 1] as [number, number, number, number] } },
    { id: 'leave', trigger: { type: 'pointer-leave' as const }, navigation: { action: 'back' as const, transition: 'instant' as const, duration: 0 } },
    { id: 'delay', trigger: { type: 'delay' as const, delay: 1250 }, navigation: link(second.id) },
    { id: 'key', trigger: { type: 'key' as const, keyCodes: [17, 65] }, navigation: link(second.id) },
  ];
  setPrototypeInteractions(editor, first, interactions); expect(readPrototype(first).interactions).toEqual(interactions);
  expect(readPrototype(deserializeGraph(serializeGraph(graph)).getNode(first.id)!).interactions).toEqual(interactions);
  editor.undoAction(); expect(readPrototype(first)).toEqual({}); editor.redoAction(); expect(readPrototype(first).interactions).toEqual(interactions);
  setPrototypeInteractions(editor, first, []); expect(readNavigation(first)).toBeUndefined(); editor.undoAction(); expect(readPrototype(first).interactions).toEqual(interactions);
});
it('bounds interaction counts, rejects ambiguous triggers and validates shortcut and Bézier data', () => {
  const first = editor.graph.createNode('FRAME', editor.state.currentPageId), action = { id: 'a', trigger: { type: 'click' as const }, navigation: link(first.id) };
  for (const interactions of [[action, { ...action, id: 'b' }], Array.from({ length: 17 }, (_, index) => ({ ...action, id: String(index), trigger: { type: 'delay' as const, delay: index } })), [{ ...action, trigger: { type: 'delay' as const, delay: Infinity } }], [{ ...action, navigation: { ...action.navigation, easing: [-1, 0, 1, 1] as [number, number, number, number] } }]]) expect(() => setPrototypeInteractions(editor, first, interactions)).toThrow('valid');
  expect(validPrototypeKeys([16, 17, 65])).toBe(true); for (const keys of [[27], [9], [65, 66], [17], [65, 65], [999]]) expect(validPrototypeKeys(keys)).toBe(false);
});
it('reads supported native multi-interactions atomically and preserves unsupported members without partial playback', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId);
  const actions = [{ connectionType: 'BACK', transitionType: 'SLIDE_FROM_BOTTOM', transitionDuration: 0.375, easingType: 'LINEAR' }];
  node.source.fig.rawNodeFields = { prototypeInteractions: [
    { event: { interactionType: 'AFTER_TIMEOUT', transitionTimeout: 1.25 }, actions },
    { event: { interactionType: 'MOUSE_ENTER', interactionDuration: 0.125 }, actions },
    { event: { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [65, 17] } }, actions },
  ] };
  expect(readPrototype(node).interactions?.map(interaction => interaction.trigger)).toEqual([{ type: 'delay', delay: 1250 }, { type: 'pointer-enter', delay: 125 }, { type: 'key', keyCodes: [17, 65] }]);
  expect(readPrototype(node).interactions?.[0]?.navigation).toEqual({ action: 'back', transition: 'slide', direction: 'bottom', duration: 375, easing: 'linear' });
  (node.source.fig.rawNodeFields.prototypeInteractions as unknown[]).push({ event: { interactionType: 'ON_HOVER' }, actions });
  expect(readPrototype(node).issue).toContain('preserved'); expect(readPrototype(node).interactions).toBeUndefined();
});
it('keeps multi-interaction local targets distinct from explicitly tagged FIG identities', () => {
  const first = editor.graph.createNode('FRAME', editor.state.currentPageId), second = editor.graph.createNode('FRAME', editor.state.currentPageId), unrelated = editor.graph.createNode('FRAME', editor.state.currentPageId); unrelated.source.id = second.id;
  setPrototypeInteractions(editor, first, [{ id: 'delay', trigger: { type: 'delay', delay: 100 }, navigation: link(second.id) }]); expect(readPrototype(first, prototypeResolver(editor.graph)).interactions?.[0]?.navigation.target).toBe(second.id);
  const raw = JSON.parse(first.pluginData.find(entry => entry.key === 'prototypeInteractions')!.value); raw[0].navigation.targetFormat = 'fig'; first.pluginData.find(entry => entry.key === 'prototypeInteractions')!.value = JSON.stringify(raw);
  expect(readPrototype(first, prototypeResolver(editor.graph)).interactions?.[0]?.navigation.target).toBe(unrelated.id);
});

it('preserves unchanged dangling destinations during partial repair but refuses newly introduced ones', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId);
  node.pluginData = [{ pluginId: 'orion.xdesign', key: 'prototypeInteractions', value: JSON.stringify([{ id: 'click', trigger: { type: 'click' }, navigation: link('missing') }]) }];
  const original = readPrototype(node).interactions!;
  expect(() => setPrototypeInteractions(editor, node, [...original, { id: 'back', trigger: { type: 'delay', delay: 1000 }, navigation: { action: 'back', transition: 'instant', duration: 0 } }])).not.toThrow();
  expect(() => setPrototypeInteractions(editor, node, [{ ...original[0]!, navigation: link('another-missing') }])).toThrow('screen');
  expect(() => setPrototypeInteractions(editor, node, [{ ...original[0]!, navigation: { ...link('missing'), transition: 'slide' } }])).toThrow('screen');
});

it('reads reversible and one-way native events without confusing legacy motion triggers', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId), actions = [{ connectionType: 'BACK' }];
  for (const [native, type] of [['ON_HOVER', 'hover'], ['ON_PRESS', 'press'], ['MOUSE_DOWN', 'pointer-down'], ['MOUSE_UP', 'pointer-up']] as const) {
    node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: native, interactionDuration: 0.125, ...(['hover', 'press'].includes(type) ? { interactionMaintained: true } : {}) }, actions }] };
    expect(readPrototype(node).interactions?.[0]?.trigger).toEqual({ type, delay: 125 });
  }
  for (const native of ['MOUSE_IN', 'MOUSE_OUT']) { node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: native }, actions }] }; expect(readPrototype(node)).toMatchObject({ imported: true, issue: expect.stringContaining('preserved') }); }
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'MOUSE_DOWN', interactionMaintained: true }, actions }] }; expect(readPrototype(node).issue).toContain('timing');
});
it('bounds video timestamps and accepts distinct hover/click triggers while refusing overlapping pointers atomically', () => {
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId), navigation = { action: 'back' as const, transition: 'instant' as const, duration: 0 };
  expect(() => setPrototypeInteractions(editor, node, [{ id: 'hit', trigger: { type: 'media-hit', time: 1 }, navigation }])).toThrow('video');
  setPrototypeInteractions(editor, node, [{ id: 'hover', trigger: { type: 'hover' }, navigation }, { id: 'click', trigger: { type: 'click' }, navigation }]);
  expect(readPrototype(node).interactions?.map(({ trigger }) => trigger.type)).toEqual(['hover', 'click']);
  for (const triggers of [[{ type: 'hover' as const }, { type: 'pointer-enter' as const }], [{ type: 'press' as const }, { type: 'pointer-down' as const }], [{ type: 'drag' as const }, { type: 'pointer-up' as const }]]) expect(() => setPrototypeInteractions(editor, node, triggers.map((trigger, i) => ({ id: String(i), trigger, navigation })))).toThrow('valid');
  expect(readPrototype(node).interactions?.map(({ trigger }) => trigger.type)).toEqual(['hover', 'click']);
  node.pluginData = [];
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_HOVER', interactionMaintained: true }, actions: [{ connectionType: 'BACK' }] }, { event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK' }] }] };
  expect(readPrototype(node)).toMatchObject({ imported: true, interactions: [{ trigger: { type: 'hover' } }, { trigger: { type: 'click' } }] });
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_MEDIA_HIT', mediaHitTime: 1.25 }, actions: [{ connectionType: 'BACK' }] }, { event: { interactionType: 'ON_MEDIA_END' }, actions: [{ connectionType: 'BACK' }] }] };
  expect(readPrototype(node).interactions?.map(({ trigger }) => trigger)).toEqual([{ type: 'media-hit', time: 1.25 }, { type: 'media-end' }]);
  for (const time of [-1, Infinity, 86401]) { node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_MEDIA_HIT', mediaHitTime: time }, actions: [{ connectionType: 'BACK' }] }] }; expect(readPrototype(node).interactions).toBeUndefined(); }
});
