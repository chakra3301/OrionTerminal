import { useEffect,useRef,useState,type CSSProperties,type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SceneNode } from '@open-pencil/scene-graph';
import { useDesignDialog } from '../useDesignDialog';
import { initializeCanvasKit,usePencilWorkspace } from './runtime';
import { ComponentBehaviourPreview,instanceBehaviour } from './behaviour/preview';
import { beginXDesignActivity } from '../runtimeActivity';
import { canvasPreviewPosition,hidePreviewSource } from './canvasPreview';

export function BehaviourPreviewDialog({node,close,canvas}:{node:SceneNode;close:()=>void;canvas?:HTMLElement}){
  const editor=usePencilWorkspace(state=>state.editor)!,dialog=useDesignDialog<HTMLDivElement>(close),[session,setSession]=useState<ComponentBehaviourPreview|null>(null),[image,setImage]=useState<ReturnType<ComponentBehaviourPreview['render']>|null>(null),[error,setError]=useState('');
  usePencilWorkspace(state=>state.version);
  const closeRef=useRef(close);closeRef.current=close;
  const source=node.type==='COMPONENT_SET'?editor.graph.getChildren(node.id).find(child=>child.type==='COMPONENT')??node:node;
  useEffect(()=>beginXDesignActivity('interactive-preview','Close the component preview before switching projects.'),[]);
  useEffect(()=>{
    const changed=()=>closeRef.current();
    const listeners=[editor.graph.emitter.on('node:updated',changed),editor.graph.emitter.on('node:created',changed),editor.graph.emitter.on('node:deleted',changed)];
    return()=>listeners.forEach(remove=>remove());
  },[editor]);
  useEffect(()=>{
    if(!canvas)return;
    const workspace=canvas.closest('.xd-pencil'),body=workspace?.querySelector('.xd-editor-body');
    const roots=[...(body?.children??[])].filter((element):element is HTMLElement=>element instanceof HTMLElement&&element!==canvas&&!element.contains(canvas));
    const context=workspace?.querySelector<HTMLElement>('.xd-editor-contextbar');if(context)roots.push(context);
    const previous=roots.map(element=>[element,element.getAttribute('inert')] as const);roots.forEach(element=>element.setAttribute('inert',''));
    return()=>previous.forEach(([element,value])=>{if(value===null)element.removeAttribute('inert');else element.setAttribute('inert',value);});
  },[canvas]);
  useEffect(()=>canvas&&image?hidePreviewSource(editor,source.id):undefined,[canvas,editor,source.id,!!image]);
  useEffect(()=>{
    let active=true,created:ComponentBehaviourPreview|null=null;
    try{created=new ComponentBehaviourPreview(editor.graph,node.id,editor.state.currentPageId);const captured=created;
      void initializeCanvasKit().then(ck=>captured.attachRenderer(ck)).then(()=>{if(active){setSession(captured);setImage(captured.render());}}).catch(error=>{if(active)setError(String(error));});
    }catch(error){setError(String(error));}
    return()=>{active=false;created?.dispose();};
  },[editor,node.id]);
  const change=(work:()=>void)=>{try{work();if(session)setImage(session.render());setError('');}catch(error){setError(String(error));}};
  const config=session?.config(),kind=config?.behaviour.kind,disabled=session?.value(session.instanceId,'disabled')===true;
  const region=(target:SceneNode|undefined):CSSProperties=>{if(!session||!image||!target)return{inset:0};const position=session.graph.getAbsolutePosition(target.id);return{left:`${(position.x-image.bounds.minX)/image.width*100}%`,top:`${(position.y-image.bounds.minY)/image.height*100}%`,width:`${target.width/image.width*100}%`,height:`${target.height/image.height*100}%`};};
  const stateEvents=(id:string)=>({onPointerEnter:()=>change(()=>session!.setState('hover',id)),onPointerLeave:()=>change(()=>session!.setState('rest',id)),onPointerDown:()=>change(()=>session!.setState('pressed',id)),onPointerUp:()=>change(()=>session!.setState('hover',id)),onPointerCancel:()=>change(()=>session!.setState('rest',id)),onFocus:()=>change(()=>session!.setState('focus',id)),onBlur:()=>change(()=>session!.setState('rest',id))});
  const interactive=session&&image&&kind;
  const groupKey=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    if(!session||!kind||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const items=session.items(),indices=items.flatMap((item,index)=>item.type==='INSTANCE'&&instanceBehaviour(session.graph,item)&&session.value(item.id,'disabled')===true?[]:[index]);if(!indices.length)return;
    event.preventDefault();const position=indices.indexOf(index),next=event.key==='Home'?indices[0]:event.key==='End'?indices.at(-1):indices[(position+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+indices.length)%indices.length];
    if(next===undefined)return;if(kind==='tabs'||kind==='radioGroup')change(()=>session.choose(next));dialog.current?.querySelector<HTMLButtonElement>(`[data-preview-item="${next}"]`)?.focus();
  };
  const preview=<div ref={dialog} role="dialog" aria-modal="true" aria-label="Interactive component preview" className={canvas?'xd-behaviour-preview xd-behaviour-inline':'xd-project-dialog xd-behaviour-preview'}><div className="xd-behaviour-preview-header"><div><strong>{node.name}</strong><p>{kind??'Interactive preview'}</p></div>{canvas&&<div><button aria-label="Preview zoom out" onClick={()=>editor.zoomToLevel(editor.state.zoom/1.25)}>−</button><button aria-label="Preview zoom in" onClick={()=>editor.zoomToLevel(editor.state.zoom*1.25)}>+</button></div>}<button onClick={close}>Close preview</button></div>
    <div className="xd-behaviour-preview-stage">
      {interactive?<div className="xd-behaviour-preview-control" role={kind==='tabs'?'tablist':kind==='radioGroup'?'radiogroup':['toggleGroup','accordion'].includes(kind)?'group':undefined} aria-label={['tabs','radioGroup','toggleGroup','accordion'].includes(kind)?node.name:undefined} style={canvas?{position:'absolute',width:image.width,height:image.height,...canvasPreviewPosition(editor.graph.getAbsolutePosition(source.id),session.graph.getAbsolutePosition(session.instanceId),image.bounds,editor.state)}:{width:Math.min(image.width,700),aspectRatio:`${image.width}/${image.height}`}}><img alt="" src={image.url} draggable={false}/>
        {['textField','textarea','numberField'].includes(kind)?kind==='textarea'?<textarea className="xd-behaviour-hit xd-behaviour-text" aria-label={node.name} disabled={disabled} style={region(session.textTarget('value'))} value={String(session.value(session.instanceId,'value'))} onChange={event=>change(()=>session.setValue('value',event.target.value))} {...stateEvents(session.instanceId)}/>:<input className="xd-behaviour-hit xd-behaviour-text" aria-label={node.name} disabled={disabled} type={kind==='numberField'?'number':'text'} style={region(session.textTarget(kind==='numberField'?'text':'value'))} value={String(session.value(session.instanceId,'value'))} min={config.behaviour.numbers.value?.min} max={config.behaviour.numbers.value?.max} step={config.behaviour.numbers.value?.step} onChange={event=>change(()=>session.setValue('value',kind==='numberField'?event.target.valueAsNumber:event.target.value))} {...stateEvents(session.instanceId)}/>
        :kind==='progress'?<progress className="xd-behaviour-hit" aria-label={node.name} max={config.behaviour.numbers.value!.max-config.behaviour.numbers.value!.min} value={Number(session.value(session.instanceId,'value'))-config.behaviour.numbers.value!.min}/>:kind==='slider'?<input className="xd-behaviour-hit xd-behaviour-range" aria-label={node.name} disabled={disabled} type="range" min={config.behaviour.numbers.value?.min} max={config.behaviour.numbers.value?.max} step={config.behaviour.numbers.value?.step} value={Number(session.value(session.instanceId,'value'))} onChange={event=>change(()=>session.setValue('value',event.target.valueAsNumber))} {...stateEvents(session.instanceId)}/>
        :['tabs','radioGroup','toggleGroup','accordion'].includes(kind)?session.items().map((item,index)=><button key={`${item.name}/${index}`} id={`xd-preview-${session.instanceId}-item-${index}`} data-preview-item={index} className="xd-behaviour-hit" aria-label={session.textContent(item)||item.name} aria-pressed={kind==='toggleGroup'?session.selected(index):undefined} aria-expanded={kind==='accordion'?session.selected(index):undefined} role={kind==='tabs'?'tab':kind==='radioGroup'?'radio':undefined} aria-selected={kind==='tabs'?session.selected(index):undefined} aria-controls={kind==='tabs'?`xd-preview-${session.instanceId}-panel-${index}`:undefined} aria-checked={kind==='radioGroup'?session.selected(index):undefined} tabIndex={['tabs','radioGroup'].includes(kind)&&!session.selected(index)?-1:0} disabled={disabled||(item.type==='INSTANCE'&&instanceBehaviour(session.graph,item)?session.value(item.id,'disabled')===true:false)} style={region(item)} onKeyDown={event=>groupKey(event,index)} onClick={()=>change(()=>session.choose(index))} {...(item.type==='INSTANCE'&&instanceBehaviour(session.graph,item)?stateEvents(item.id):{})}/>)
        :<button className="xd-behaviour-hit" aria-label={node.name} disabled={disabled} role={kind==='checkbox'?'checkbox':kind==='switch'?'switch':kind==='radio'?'radio':undefined} aria-checked={['checkbox','switch','radio'].includes(kind)?session.value(session.instanceId,'value')===true:undefined} aria-pressed={kind==='toggle'?session.value(session.instanceId,'value')===true:undefined} aria-expanded={kind==='collapsible'?session.value(session.instanceId,'open')===true:undefined} style={region(kind==='collapsible'?session.part(session.instanceId,'trigger'):undefined)} onClick={()=>change(()=>session.activate())} {...stateEvents(session.instanceId)}/>}
        {kind==='numberField'&&(['increment','decrement'] as const).map(part=>{const target=session.part(session.instanceId,part);return target?<button key={part} className="xd-behaviour-hit" aria-label={`${part} ${node.name}`} style={region(target)} disabled={disabled} onClick={()=>change(()=>session.setValue('value',Number(session.value(session.instanceId,'value'))+(part==='increment'?1:-1)*(config.behaviour.numbers.value?.step??1)))}/>:null;})}
      </div>:<p role="status">{error?'Preview unavailable':'Preparing preview…'}</p>}
    </div>
    {session&&kind==='tabs'&&session.part(session.instanceId,'panels')&&session.graph.getChildren(session.part(session.instanceId,'panels')!.id).map((panel,index)=><div key={index} id={`xd-preview-${session.instanceId}-panel-${index}`} role="tabpanel" aria-labelledby={`xd-preview-${session.instanceId}-item-${index}`} hidden={!session.selected(index)} className="xd-behaviour-semantic-panel">{session.textContent(panel)||panel.name}</div>)}
    {session&&<div className="xd-behaviour-preview-footer"><span aria-live="polite">{session.state()}</span>{kind==='progress'?<label>Preview value<input type="range" aria-label={`Preview ${node.name} value`} min={config!.behaviour.numbers.value!.min} max={config!.behaviour.numbers.value!.max} step={config!.behaviour.numbers.value!.step} value={Number(session.value(session.instanceId,'value'))} onChange={event=>change(()=>session.setValue('value',event.target.valueAsNumber))}/></label>:<label><input type="checkbox" checked={disabled} onChange={event=>change(()=>session.setDisabled(event.target.checked))}/>Simulate disabled</label>}</div>}
    {error&&<p role="alert">{error}</p>}
  </div>;
  return canvas?createPortal(<div className="xd-behaviour-canvas-preview" onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}>{preview}</div>,canvas):<div className="xd-project-dialog-scrim">{preview}</div>;
}
