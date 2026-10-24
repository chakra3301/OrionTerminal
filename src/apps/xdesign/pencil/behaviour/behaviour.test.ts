// @vitest-environment node
import { afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { createEditor,type Editor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneNode } from '@open-pencil/scene-graph';
import { bindComponentProperty,createComponentProperty } from '../componentProperties';
import { createSlot,installSlotSupport } from '../slots';
import { deserializeGraph,serializeGraph } from '../document';
import { parseFigWithSlots } from '../figSlots';
import { exportFigImageCompatible } from '../figPaintCompatibility';
import { installProceduralPaints } from '../proceduralPaints';
import { setComponentBehaviour } from './editor';
import { behaviourProperties,missingBindings,readBehaviour } from './model';
import { ComponentBehaviourPreview } from './preview';
import type { BehaviourKind } from './kinds';
let editor:Editor,ck:CanvasKit;const previews:ComponentBehaviourPreview[]=[];
beforeAll(async()=>{ck=await getCanvasKit();installProceduralPaints();});
beforeEach(()=>{editor=createEditor();installSlotSupport(editor.graph);});
afterEach(()=>{previews.splice(0).forEach(preview=>preview.dispose());editor.dispose();});
const main=(name='Control')=>editor.graph.createNode('COMPONENT',editor.state.currentPageId,{name,width:200,height:80});
const preview=(node:SceneNode)=>{const result=new ComponentBehaviourPreview(editor.graph,node.id,editor.state.currentPageId);previews.push(result);return result;};
function slot(owner:SceneNode,name:string,width=200,height=20,x=0,y=0){const frame=editor.graph.createNode('FRAME',owner.id,{name,width,height,x,y});createSlot(editor,frame);return frame;}
function booleanControl(kind:BehaviourKind,name=kind){const owner=main(name),indicator=editor.graph.createNode('RECTANGLE',owner.id,{name:'Indicator',visible:false,width:10,height:10});const property=createComponentProperty(editor,owner,'Checked','BOOLEAN','false');bindComponentProperty(editor,indicator,'VISIBLE',property);setComponentBehaviour(editor,owner,{kind,values:{value:'Checked'}});return owner;}
describe('component behaviors',()=>{
  it('validates bindings and ranges, keeps unrelated plugin data, and supports complete undo and reopening',()=>{
    const owner=main();editor.graph.updateNode(owner.id,{pluginData:[{pluginId:'example',key:'keep',value:'yes'}]});
    expect(()=>setComponentBehaviour(editor,owner,{kind:'checkbox',values:{value:'Missing'}})).toThrow('needs');
    setComponentBehaviour(editor,owner,{kind:'checkbox'});expect(missingBindings(editor.graph,owner,readBehaviour(owner)!)).toEqual(['value']);
    expect(()=>preview(owner)).toThrow('Bind');editor.undoAction();expect(readBehaviour(owner)).toBeNull();editor.redoAction();expect(readBehaviour(deserializeGraph(serializeGraph(editor.graph)).getNode(owner.id)!)).toMatchObject({kind:'checkbox'});expect(owner.pluginData.some(entry=>entry.pluginId==='example')).toBe(true);
    expect(()=>setComponentBehaviour(editor,owner,{kind:'numberField',numbers:{value:{min:2,max:1,step:0}}})).toThrow('max above min');
    expect(()=>setComponentBehaviour(editor,owner,{kind:'numberField',numbers:{value:{min:0,max:10,step:1,default:50}}})).toThrow('inside');
    editor.graph.updateNode(owner.id,{locked:true});expect(()=>setComponentBehaviour(editor,owner,null)).toThrow('unlocked');
  });
  it.each(['toggle','switch','checkbox','radio'] as const)('runs %s values in an isolated graph and blocks disabled input',kind=>{
    const owner=booleanControl(kind),before=serializeGraph(editor.graph),session=preview(owner);expect(session.value(session.instanceId,'value')).toBe(false);session.activate();expect(session.value(session.instanceId,'value')).toBe(true);expect(session.graph.getChildren(session.instanceId)[0]?.visible).toBe(true);
    session.activate();expect(session.value(session.instanceId,'value')).toBe(kind==='radio');session.setDisabled(true);session.activate();expect(session.value(session.instanceId,'value')).toBe(kind==='radio');expect(serializeGraph(editor.graph)).toBe(before);
    session.dispose();expect(()=>session.activate()).toThrow('closed');
  });
  it.each(['textField','textarea'] as const)('binds typed Unicode text in %s without altering the document',kind=>{
    const owner=main(),text=editor.graph.createNode('TEXT',owner.id,{name:'Value',text:'Hello'}),property=createComponentProperty(editor,owner,'Text','TEXT','Hello');bindComponentProperty(editor,text,'TEXT',property);setComponentBehaviour(editor,owner,{kind,values:{value:'Text'}});
    const before=serializeGraph(editor.graph),session=preview(owner);session.setValue('value','你好 👩🏽‍🎨\nمرحبا');expect(session.textTarget('value')?.text).toBe('你好 👩🏽‍🎨\nمرحبا');expect(serializeGraph(editor.graph)).toBe(before);expect(()=>session.setValue('value','x'.repeat(4097))).toThrow('4,096');
  });
  it('snaps number fields to their range and updates the designed text property',()=>{
    const owner=main(),text=editor.graph.createNode('TEXT',owner.id,{name:'Value',text:'12'}),property=createComponentProperty(editor,owner,'Text','TEXT','12');bindComponentProperty(editor,text,'TEXT',property);setComponentBehaviour(editor,owner,{kind:'numberField',values:{text:'Text'},numbers:{value:{min:0,max:20,step:2,default:12}}});
    const session=preview(owner);session.setValue('value',13);expect(session.value(session.instanceId,'value')).toBe(14);expect(session.textTarget('text')?.text).toBe('14');session.setValue('value',99);expect(session.textTarget('text')?.text).toBe('20');
  });
  it('keeps fractional number steps readable and rejects changes after disposal',()=>{
    const owner=main(),text=editor.graph.createNode('TEXT',owner.id,{text:'0'}),property=createComponentProperty(editor,owner,'Text','TEXT','0');bindComponentProperty(editor,text,'TEXT',property);setComponentBehaviour(editor,owner,{kind:'numberField',values:{text:'Text'},numbers:{value:{min:0,max:1,step:0.1,default:0}}});
    const session=preview(owner);session.setValue('value',0.3);expect(session.value(session.instanceId,'value')).toBe(0.3);
    session.dispose();expect(()=>session.setDisabled(true)).toThrow('closed');
  });
  it.each(['slider','progress'] as const)('positions %s parts from real slot bindings',kind=>{
    const owner=main();slot(owner,'Track',200);slot(owner,kind==='slider'?'Thumb':'Indicator',kind==='slider'?20:200);
    setComponentBehaviour(editor,owner,{kind,numbers:{value:{min:0,max:100,step:10,default:50}},parts:kind==='slider'?{track:'Track',thumb:'Thumb'}:{track:'Track',indicator:'Indicator'}});
    const session=preview(owner);session.setValue('value',100);if(kind==='slider')expect(session.part(session.instanceId,'thumb')?.x).toBe(180);else expect(session.part(session.instanceId,'indicator')?.width).toBe(200);
    session.setValue('value',25);if(kind==='slider')expect(session.part(session.instanceId,'thumb')?.x).toBe(54);else expect(session.part(session.instanceId,'indicator')?.width).toBe(60);
  });
  it.each(['radioGroup','toggleGroup'] as const)('selects %s children through their own component bindings',kind=>{
    const item=booleanControl(kind==='radioGroup'?'radio':'toggle'),owner=main(),items=slot(owner,'Items');editor.graph.createInstance(item.id,items.id);editor.graph.createInstance(item.id,items.id,{x:80});setComponentBehaviour(editor,owner,{kind,parts:{items:'Items'}});
    const session=preview(owner);session.choose(1);expect(session.selected(1)).toBe(true);expect(session.value(session.items()[1]!.id,'value')).toBe(true);expect(session.value(session.items()[0]!.id,'value')).toBe(false);
    session.choose(0);expect(session.selected(1)).toBe(kind==='toggleGroup');session.setDisabled(true);session.choose(1);expect(session.selected(1)).toBe(kind==='toggleGroup');
  });
  it('reveals collapsible and accordion content through required slots',()=>{
    const item=main('Item');slot(item,'Trigger');slot(item,'Content',200,30,0,20);setComponentBehaviour(editor,item,{kind:'collapsible',parts:{trigger:'Trigger',content:'Content'}});
    const single=preview(item);expect(single.part(single.instanceId,'content')?.visible).toBe(false);single.activate();expect(single.part(single.instanceId,'content')?.visible).toBe(true);
    const owner=main('Accordion'),items=slot(owner,'Items');editor.graph.createInstance(item.id,items.id);editor.graph.createInstance(item.id,items.id,{y:50});setComponentBehaviour(editor,owner,{kind:'accordion',parts:{items:'Items'}});
    const session=preview(owner);session.choose(1);expect(session.part(session.items()[1]!.id,'content')?.visible).toBe(true);expect(session.part(session.items()[0]!.id,'content')?.visible).toBe(false);
  });
  it('changes tab panels without modifying their authored visibility',()=>{
    const owner=main(),list=slot(owner,'List'),panels=slot(owner,'Panels');editor.graph.createNode('RECTANGLE',list.id,{name:'First'});editor.graph.createNode('RECTANGLE',list.id,{name:'Second'});editor.graph.createNode('FRAME',panels.id,{name:'First panel'});editor.graph.createNode('FRAME',panels.id,{name:'Second panel'});setComponentBehaviour(editor,owner,{kind:'tabs',parts:{list:'List',panels:'Panels'}});
    const before=serializeGraph(editor.graph),session=preview(owner);session.choose(1);expect(session.graph.getChildren(session.part(session.instanceId,'panels')!.id).map(node=>node.visible)).toEqual([false,true]);expect(serializeGraph(editor.graph)).toBe(before);
  });
  it('renders real interaction-state pixels and exports bindings with their native fig property identities',async()=>{
    const graph=editor.graph,set=graph.createNode('COMPONENT_SET',editor.state.currentPageId,{name:'Button'});editor.addPropertyDefinition(set.id,'State','VARIANT','Default');
    for(const [index,state] of ['Default','Hover','Pressed','Focus','Disabled'].entries())graph.createNode('COMPONENT',set.id,{name:state,width:20,height:20,componentPropertyValues:{State:state},fills:[{type:'SOLID',color:{r:index===0?1:0,g:index===1?1:0,b:index===2?1:0,a:1},opacity:1,visible:true}]});
    setComponentBehaviour(editor,set,{kind:'button',states:'State'});expect(behaviourProperties(graph,set).find(def=>def.name==='State')?.variantOptions).toContain('Hover');
    const session=preview(graph.getChildren(set.id)[0]!);await session.attachRenderer(ck);const pixels=()=>{const bytes=Uint8Array.from(atob(session.render().url.split(',')[1]!),char=>char.charCodeAt(0)),image=ck.MakeImageFromEncoded(bytes)!;try{return [...image.readPixels(5,5,{width:1,height:1,alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB})!];}finally{image.delete();}};
    expect(pixels()).toEqual([255,0,0,255]);session.setState('hover');expect(pixels()).toEqual([0,255,0,255]);session.setState('pressed');expect(pixels()).toEqual([0,0,255,255]);
    const restored=await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).buffer),reopened=[...restored.nodes.values()].find(node=>node.name==='Button'&&node.type==='COMPONENT_SET')!,behaviour=readBehaviour(reopened)!;
    expect(behaviour.states?.propertyId).toBe(reopened.componentPropertyDefinitions.find(def=>def.name==='State')?.id);expect(missingBindings(restored,reopened,behaviour)).toEqual([]);
  });
  it('round trips boolean, text and slot behavior bindings without retaining stale local identities',async()=>{
    const textOwner=main('Input'),text=editor.graph.createNode('TEXT',textOwner.id,{text:'Hello'}),textProperty=createComponentProperty(editor,textOwner,'Text','TEXT','Hello');
    bindComponentProperty(editor,text,'TEXT',textProperty);createComponentProperty(editor,textOwner,'Disabled','BOOLEAN','false');
    setComponentBehaviour(editor,textOwner,{kind:'textField',values:{value:'Text',disabled:'Disabled'}});
    const slider=main('Slider');slot(slider,'Track');slot(slider,'Thumb',20);
    setComponentBehaviour(editor,slider,{kind:'slider',parts:{track:'Track',thumb:'Thumb'},numbers:{value:{min:0,max:10,step:0.5,default:3}}});
    const restored=await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(editor.graph)))).buffer);
    const reopened=(name:string)=>[...restored.nodes.values()].find(node=>node.name===name&&node.type==='COMPONENT')!;
    for(const name of ['Input','Slider'])expect(missingBindings(restored,reopened(name),readBehaviour(reopened(name))!)).toEqual([]);
    const inputSession=new ComponentBehaviourPreview(restored,reopened('Input').id,restored.getPages()[0]!.id);previews.push(inputSession);inputSession.setValue('value','Updated');expect(inputSession.textTarget('value')?.text).toBe('Updated');inputSession.setDisabled(true);inputSession.setValue('value','Ignored');expect(inputSession.textTarget('value')?.text).toBe('Updated');
    const sliderSession=new ComponentBehaviourPreview(restored,reopened('Slider').id,restored.getPages()[0]!.id);previews.push(sliderSession);sliderSession.setValue('value',5);expect(sliderSession.part(sliderSession.instanceId,'thumb')?.x).toBe(90);
  });
});
