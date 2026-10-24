import { createEditor, type Editor } from '@open-pencil/core/editor';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { computeContentBounds } from '@open-pencil/core/io';
import { findComponentPropertyTarget, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { cloneDesignSubgraph } from '../graphSubset';
import { instanceSlotFrames,mainSlotComponent,slotDefinitions,slotPropertyId } from '../slots';
import { renderDesignNodes } from '../proceduralPaints';
import { behaviourOwner,behaviourProperties,missingBindings,readBehaviour } from './model';
import type { InteractionState } from './kinds';

export function instanceBehaviour(graph:SceneGraph,instance:SceneNode){
  const main=mainSlotComponent(graph,instance),owner=main&&behaviourOwner(graph,main),behaviour=owner&&readBehaviour(owner);
  return owner&&behaviour?{owner,behaviour}:null;
}
type PreviewValue=boolean|string|number;
export type PreviewTarget={instanceId:string;part?:string;item?:number};

/** An isolated graph and renderer: preview input never modifies the saved design. */
export class ComponentBehaviourPreview {
  readonly editor:Editor;
  readonly instanceId:string;
  private renderer:SkiaRenderer|null=null;
  private disposed=false;
  private values=new Map<string,Map<string,PreviewValue>>();
  private choices=new Map<string,Set<number>>();
  private lastStates=new Map<string,InteractionState>();
  private restoreSizes=new Map<string,{x:number;y:number;width:number;height:number}>();
  constructor(source:SceneGraph,nodeId:string,pageId:string){
    const graph=cloneDesignSubgraph(source,[nodeId]),node=graph.getNode(nodeId);if(!node)throw new Error('This component is no longer available.');
    this.editor=createEditor({graph});this.editor.state.currentPageId=pageId;
    this.editor.undo.push=()=>undefined;
    try{
    let instance:SceneNode|null|undefined=node.type==='INSTANCE'?node:null;
    if(!instance){const component=node.type==='COMPONENT_SET'?graph.getChildren(node.id).find(child=>child.type==='COMPONENT'):node;
      if(component?.type!=='COMPONENT')throw new Error('Choose a component to preview.');
      instance=graph.createInstance(component.id,pageId,{x:0,y:0});
    }
    if(!instance)throw new Error('The preview instance could not be created.');
    this.instanceId=instance.id;
    const current=this.config(instance.id),missing=missingBindings(graph,current.owner,current.behaviour);
    if(missing.length)throw new Error(`Bind these behavior values or parts first: ${missing.join(', ')}.`);
    this.layout();
    }catch(error){this.editor.dispose();throw error;}
  }
  get graph(){return this.editor.graph;}
  get instance(){return this.graph.getNode(this.instanceId)!;}
  config(id=this.instanceId){const current=instanceBehaviour(this.graph,this.graph.getNode(id)!);if(!current)throw new Error('This component has no configured behavior.');return current;}
  private active(){if(this.disposed)throw new Error('The component preview has closed.');}
  value(id:string,valueId:string):PreviewValue{
    const cached=this.values.get(id)?.get(valueId);if(cached!==undefined)return cached;
    const {behaviour}=this.config(id),binding=behaviour.booleans[valueId]??behaviour.texts[valueId];
    if(binding){const definition=this.editor.getInstanceComponentPropertyDefinitions(id).find(def=>def.id===binding.propertyId);if(definition){const value=this.editor.getInstanceComponentPropertyValue(id,definition);return definition.type==='BOOLEAN'?value==='true':definition.type==='VARIANT'?value===behaviour.booleans[valueId]?.on:value;}}
    if(behaviour.numbers[valueId])return behaviour.numbers[valueId].default;
    return valueId==='open'||valueId==='disabled'||behaviour.booleans[valueId]?false:'';
  }
  private cache(id:string,valueId:string,value:PreviewValue){let values=this.values.get(id);if(!values){values=new Map();this.values.set(id,values);}values.set(valueId,value);}
  private applyProperty(id:string,propertyId:string,value:string){
    const definition=this.editor.getInstanceComponentPropertyDefinitions(id).find(def=>def.id===propertyId);
    if(!definition)throw new Error('A behavior binding is no longer available in this variant.');
    if(definition.type==='VARIANT'){
      const result=this.editor.switchInstanceVariant(id,definition.name,value);if(['invalid','unavailable','conflict'].includes(result.kind))throw new Error(`The ${definition.name}=${value} variant combination is unavailable.`);
    }else this.editor.setInstanceComponentProperty(id,propertyId,value);
  }
  setValue(valueId:string,value:PreviewValue,id=this.instanceId){
    this.active();const {behaviour}=this.config(id);
    if(this.value(id,'disabled')===true&&valueId!=='disabled')return;
    const boolean=behaviour.booleans[valueId],text=behaviour.texts[valueId],number=behaviour.numbers[valueId];
    if(boolean){if(typeof value!=='boolean')throw new Error('This behavior value must be on or off.');const definition=this.editor.getInstanceComponentPropertyDefinitions(id).find(def=>def.id===boolean.propertyId);
      this.applyProperty(id,boolean.propertyId,definition?.type==='BOOLEAN'?String(value):(value?boolean.on:boolean.off)??'');
    }else if(text){if(typeof value!=='string'||value.length>4096)throw new Error('Enter text up to 4,096 characters.');this.applyProperty(id,text.propertyId,value);
      if(valueId==='value'&&behaviour.booleans.filled){const binding=behaviour.booleans.filled,definition=this.editor.getInstanceComponentPropertyDefinitions(id).find(def=>def.id===binding.propertyId);this.applyProperty(id,binding.propertyId,definition?.type==='BOOLEAN'?String(value.length>0):(value.length?binding.on:binding.off)??'');this.cache(id,'filled',value.length>0);}
    }else if(number){if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Enter a finite number.');value=Math.max(number.min,Math.min(number.max,Number((number.min+Math.round((value-number.min)/number.step)*number.step).toPrecision(15))));
      if(behaviour.kind==='numberField'&&behaviour.texts.text)this.applyProperty(id,behaviour.texts.text.propertyId,String(value));
    }else if(valueId!=='open')throw new Error('This behavior has no such value.');
    this.cache(id,valueId,value);this.layout();
  }
  setDisabled(value:boolean,id=this.instanceId){
    this.active();
    if(this.config(id).behaviour.booleans.disabled)this.setValue('disabled',value,id);else this.cache(id,'disabled',value);
    this.setState(value?'disabled':'rest',id);
  }
  setState(state:InteractionState,id=this.instanceId){
    this.active();const {behaviour}=this.config(id),disabled=this.value(id,'disabled')===true;
    const next=disabled?'disabled':state,value=behaviour.states?.[next]??behaviour.states?.rest;
    if(value!==undefined&&behaviour.states)this.applyProperty(id,behaviour.states.propertyId,value);
    this.lastStates.set(id,next);this.layout();
  }
  state(id=this.instanceId){return this.lastStates.get(id)??'rest';}
  part(id:string,partId:string){
    const {owner,behaviour}=this.config(id),property=behaviour.parts[partId];if(!property)return undefined;
    const name=behaviourProperties(this.graph,owner).find(def=>def.id===property)?.name;
    return instanceSlotFrames(this.graph,this.graph.getNode(id)!).find(frame=>slotPropertyId(frame)===property||slotDefinitions(this.graph,this.graph.getNode(id)!).find(def=>def.id===slotPropertyId(frame))?.name===name);
  }
  items(id=this.instanceId){const frame=this.part(id,'items')??this.part(id,'list');return frame?this.graph.getChildren(frame.id):[];}
  selected(index:number,id=this.instanceId){return this.choices.get(id)?.has(index)??index===0;}
  choose(index:number,id=this.instanceId){
    this.active();if(this.value(id,'disabled')===true)return;const {behaviour}=this.config(id),items=this.items(id);if(index<0||index>=items.length)return;
    const item=items[index]!;if(item.type==='INSTANCE'&&instanceBehaviour(this.graph,item)&&this.value(item.id,'disabled')===true)return;
    const multiple=behaviour.kind==='toggleGroup'||behaviour.kind==='accordion',chosen=new Set(this.choices.get(id)??(multiple?[]:[0]));
    if(multiple){if(chosen.has(index))chosen.delete(index);else chosen.add(index);}else{chosen.clear();chosen.add(index);}
    this.choices.set(id,chosen);
    items.forEach((item,itemIndex)=>{if(item.type!=='INSTANCE'||!instanceBehaviour(this.graph,item))return;const valueId=behaviour.kind==='accordion'?'open':'value';this.setValue(valueId,chosen.has(itemIndex),item.id);});
    this.layout();
  }
  activate(id=this.instanceId){
    this.active();
    const {behaviour}=this.config(id);if(this.value(id,'disabled')===true)return;
    if(['checkbox','toggle','switch','radio'].includes(behaviour.kind))this.setValue('value',behaviour.kind==='radio'||this.value(id,'value')!==true,id);
    if(behaviour.kind==='collapsible')this.setValue('open',this.value(id,'open')!==true,id);
  }
  private resetPart(frame:SceneNode){
    if(!this.restoreSizes.has(frame.id))this.restoreSizes.set(frame.id,{x:frame.x,y:frame.y,width:frame.width,height:frame.height});
    const initial=this.restoreSizes.get(frame.id)!;this.graph.updateNode(frame.id,initial);
  }
  private layout(){
    this.editor.runLayoutForNode(this.editor.state.currentPageId);
    for(const node of [...this.graph.nodes.values()]){
      if(node.type!=='INSTANCE'||!instanceBehaviour(this.graph,node)||!(node.id===this.instanceId||this.graph.isDescendant(node.id,this.instanceId)))continue;
      const {behaviour}=this.config(node.id);
      if(behaviour.kind==='numberField'&&behaviour.texts.text){const text=this.textTarget('text',node.id),value=String(this.value(node.id,'value'));if(text?.text!==value)this.applyProperty(node.id,behaviour.texts.text.propertyId,value);}
      if(['radioGroup','toggleGroup','accordion','tabs'].includes(behaviour.kind)){
        const multiple=behaviour.kind==='toggleGroup'||behaviour.kind==='accordion';
        if(!this.choices.has(node.id)){
          const first=this.items(node.id).findIndex(item=>item.type!=='INSTANCE'||!instanceBehaviour(this.graph,item)||this.value(item.id,'disabled')!==true);
          this.choices.set(node.id,new Set(multiple||first<0?[]:[first]));
        }
        if(behaviour.kind!=='tabs')for(const [index,item] of this.items(node.id).entries()){
          if(item.type!=='INSTANCE'||!instanceBehaviour(this.graph,item))throw new Error('Each group item needs its own component behavior.');
          const child=this.config(item.id).behaviour,valueId=behaviour.kind==='accordion'?'open':'value',expected=behaviour.kind==='radioGroup'?'radio':behaviour.kind==='toggleGroup'?'toggle':'collapsible';
          if(child.kind!==expected)throw new Error(`Each ${behaviour.kind} item must behave as ${expected}.`);
          const selected=this.selected(index,node.id),binding=child.booleans[valueId],definition=binding&&this.editor.getInstanceComponentPropertyDefinitions(item.id).find(def=>def.id===binding.propertyId);
          if(binding&&this.value(item.id,valueId)!==selected)this.applyProperty(item.id,binding.propertyId,definition?.type==='BOOLEAN'?String(selected):(selected?binding.on:binding.off)??'');
          this.cache(item.id,valueId,selected);
        }
      }
      if(behaviour.kind==='collapsible'){const content=this.part(node.id,'content');if(content)this.graph.updateNode(content.id,{visible:this.value(node.id,'open')===true});}
      if(behaviour.kind==='tabs'){const panels=this.part(node.id,'panels');if(panels)this.graph.getChildren(panels.id).forEach((panel,index)=>this.graph.updateNode(panel.id,{visible:this.selected(index,node.id)}));}
      if(behaviour.kind==='slider'||behaviour.kind==='progress'){
        const settings=behaviour.numbers.value,track=this.part(node.id,'track'),thumb=this.part(node.id,'thumb'),range=this.part(node.id,'range')??this.part(node.id,'indicator');if(!settings||!track)continue;
        const ratio=Math.max(0,Math.min(1,(Number(this.value(node.id,'value'))-settings.min)/(settings.max-settings.min)));
        if(thumb){this.resetPart(thumb);const trackPos=this.graph.getAbsolutePosition(track.id),parentPos=thumb.parentId?this.graph.getAbsolutePosition(thumb.parentId):{x:0,y:0};this.graph.updateNode(thumb.id,{x:trackPos.x-parentPos.x+ratio*Math.max(0,track.width-thumb.width)});}
        if(range){this.resetPart(range);this.graph.updateNode(range.id,{width:track.width*ratio});}
      }
    }
    this.graph.clearAbsPosCache();this.renderer?.invalidateAllPictures();
  }
  async attachRenderer(ck:CanvasKit){this.active();const surface=ck.MakeSurface(64,64);if(!surface)throw new Error('The interactive preview renderer is unavailable.');this.renderer=new SkiaRenderer(ck,surface);await this.renderer.loadFonts();await this.editor.loadFontsForNodes([this.instanceId]);this.active();}
  render(){
    this.active();if(!this.renderer)throw new Error('The preview renderer is loading.');
    const bounds=computeContentBounds(this.graph,[this.instanceId]);if(!bounds||bounds.maxX<=bounds.minX||bounds.maxY<=bounds.minY)throw new Error('This component has no visible preview.');
    let page=this.instance;while(page.parentId&&page.type!=='CANVAS')page=this.graph.getNode(page.parentId)!;
    const bytes=renderDesignNodes(this.renderer.ck,this.renderer,this.graph,page.id,[this.instanceId],{format:'PNG',scale:Math.min(2,720/Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY))});if(!bytes)throw new Error('The interactive preview could not render.');
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {url:`data:image/png;base64,${btoa(binary)}`,bounds,width:bounds.maxX-bounds.minX,height:bounds.maxY-bounds.minY};
  }
  textTarget(valueId:string,id=this.instanceId){const binding=this.config(id).behaviour.texts[valueId];return binding?findComponentPropertyTarget(this.graph,this.graph.getNode(id)!,binding.propertyId)?.node:undefined;}
  textContent(node:SceneNode):string{const text:string[]=[],pending=[node.id];while(pending.length){const current=this.graph.getNode(pending.pop()!);if(!current||!current.visible)continue;if(current.text)text.push(current.text);pending.push(...[...current.childIds].reverse());}return text.join(' ');}
  dispose(){if(this.disposed)return;this.disposed=true;this.renderer?.destroy();this.renderer=null;this.editor.dispose();this.values.clear();this.choices.clear();this.lastStates.clear();this.restoreSizes.clear();}
}
